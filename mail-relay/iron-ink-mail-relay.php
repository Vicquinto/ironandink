<?php
/**
 * Iron & Ink — HTTPS mail relay (upload to the GreenGeeks cPanel account).
 *
 * The DigitalOcean droplet can't make outbound SMTP connections, so the app
 * POSTs each email here over HTTPS and this script hands it to the hosting
 * server's local mail system (PHP mail() → Exim), sending as FROM_ADDRESS.
 *
 * Request (made by lib/mailer.js on the droplet):
 *   POST, Content-Type: application/json
 *   X-Relay-Timestamp: <unix seconds>
 *   X-Relay-Signature: hex HMAC-SHA256( timestamp + "." + raw body, RELAY_SECRET )
 *   Body: {"id":"...","to":"a@b.c","subject":"...","html":"...","text":"...",
 *          "from":"<must equal FROM_ADDRESS>","fromName":"..."}
 * Response: JSON {"ok":true,"messageId":"..."} or {"ok":false,"error":"..."}
 *
 * Security:
 *  - HTTPS only; POST only; body size capped.
 *  - Every request must carry a valid HMAC signature made with the shared
 *    secret, over the timestamp AND the exact body — nothing can be altered.
 *  - Requests more than 5 minutes old (or ahead) are rejected, and each
 *    signature is accepted only once (replay protection).
 *  - Optional allow-list of source IPs (the droplet).
 *  - Exactly one recipient; strict field validation; CR/LF rejected in every
 *    header-bound field (no header injection); sender fixed to FROM_ADDRESS.
 *  - Hourly send cap.
 *  - Never prints debug output; problems go to the PHP error log only.
 *
 * Requires PHP 7.4+ (stock on cPanel). No Composer, no extensions beyond core.
 */

declare(strict_types=1);

// ============================ CONFIGURATION ================================
// 1. Paste the SAME long random secret you put in MAIL_RELAY_SECRET on the droplet.
const RELAY_SECRET = 'PASTE-YOUR-SECRET-HERE';

// 2. The mailbox mail is sent from. It must be an email account (or at least a
//    domain) on THIS cPanel account, and must equal MAIL_FROM on the droplet.
const FROM_ADDRESS = 'noreply@ironandinktheology.com';

// 3. Display name used when the request doesn't supply one.
const FROM_NAME = 'Iron & Ink';

// 4. Optional: only accept requests from these IP addresses (the droplet's
//    public IPv4, e.g. ['203.0.113.10']). Leave empty to accept any IP — the
//    HMAC signature is still required either way.
const ALLOWED_IPS = [];

// 5. Abuse protection: maximum messages per rolling hour.
const MAX_PER_HOUR = 100;

// 6. Where the replay list and send counter are kept. '' = automatic:
//    <your cPanel home>/iron-ink-mail-relay-state (outside public_html).
const STATE_DIR = '';
// ===========================================================================

const MAX_SKEW_SECONDS = 300;      // requests older/newer than 5 minutes are refused
const MAX_BODY_BYTES   = 600000;
const MAX_HTML_BYTES   = 400000;
const MAX_TEXT_BYTES   = 150000;
const MAX_SUBJECT_LEN  = 200;
const MAX_NAME_LEN     = 100;

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

function relay_respond(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload);
    exit;
}

function relay_fail(int $status, string $error, string $logDetail = ''): void
{
    if ($logDetail !== '') {
        error_log('[iron-ink-mail-relay] ' . $logDetail);
    }
    relay_respond($status, ['ok' => false, 'error' => $error]);
}

/** True if $s contains CR, LF, NUL or other ASCII control characters (tab allowed). */
function relay_has_controls(string $s): bool
{
    return preg_match('/[\x00-\x08\x0A-\x1F\x7F]/', $s) === 1;
}

/**
 * RFC 2047 encode a header value as one or more UTF-8 base64 encoded-words,
 * folded so no encoded-word exceeds 75 characters. Splits only on character
 * boundaries.
 */
function relay_encode_header(string $value): string
{
    if ($value === '') {
        return '';
    }
    $chars = preg_split('//u', $value, -1, PREG_SPLIT_NO_EMPTY);
    if ($chars === false) {
        $chars = str_split($value);
    }
    $words = [];
    $chunk = '';
    foreach ($chars as $ch) {
        if (strlen($chunk) + strlen($ch) > 45) {   // 45 bytes → 60 base64 chars
            $words[] = '=?UTF-8?B?' . base64_encode($chunk) . '?=';
            $chunk = '';
        }
        $chunk .= $ch;
    }
    if ($chunk !== '') {
        $words[] = '=?UTF-8?B?' . base64_encode($chunk) . '?=';
    }
    return implode("\r\n ", $words);
}

/** Directory for relay state; created 0700 if missing. */
function relay_state_dir(): string
{
    if (STATE_DIR !== '') {
        return rtrim(STATE_DIR, '/');
    }
    $home = getenv('HOME') ?: '';
    if ($home === '' && function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
        $info = posix_getpwuid(posix_geteuid());
        $home = is_array($info) && isset($info['dir']) ? (string) $info['dir'] : '';
    }
    if ($home === '' || !is_dir($home)) {
        // Last resort: next to this script, protected from web access.
        $dir = __DIR__ . '/.iron-ink-mail-relay-state';
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
            @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
        }
        return $dir;
    }
    return rtrim($home, '/') . '/iron-ink-mail-relay-state';
}

// ---------------------------------------------------------------------------
// 0. Configuration sanity (logged, never echoed in detail)
// ---------------------------------------------------------------------------
if (strlen(RELAY_SECRET) < 32 || strpos(RELAY_SECRET, 'PASTE-') === 0) {
    relay_fail(500, 'relay not configured', 'RELAY_SECRET is not set (needs at least 32 characters)');
}
if (!filter_var(FROM_ADDRESS, FILTER_VALIDATE_EMAIL) || relay_has_controls(FROM_ADDRESS)) {
    relay_fail(500, 'relay not configured', 'FROM_ADDRESS is not a valid email address');
}

// ---------------------------------------------------------------------------
// 1. Transport: POST over HTTPS only
// ---------------------------------------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    relay_fail(405, 'method not allowed');
}
$isHttps = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
    || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443'
    || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
if (!$isHttps) {
    relay_fail(403, 'https required');
}

// ---------------------------------------------------------------------------
// 2. Optional IP allow-list
// ---------------------------------------------------------------------------
$remoteIp = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
if (count(ALLOWED_IPS) > 0 && !in_array($remoteIp, ALLOWED_IPS, true)) {
    relay_fail(403, 'forbidden', 'rejected request from non-allowed IP ' . $remoteIp);
}

// ---------------------------------------------------------------------------
// 3. Read the raw body (size-capped)
// ---------------------------------------------------------------------------
$declaredLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($declaredLength <= 0 || $declaredLength > MAX_BODY_BYTES) {
    relay_fail(413, 'payload size not accepted');
}
$body = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
if (!is_string($body) || strlen($body) !== $declaredLength) {
    relay_fail(400, 'could not read request body');
}

// ---------------------------------------------------------------------------
// 4. Signature + freshness
// ---------------------------------------------------------------------------
$timestamp = (string) ($_SERVER['HTTP_X_RELAY_TIMESTAMP'] ?? '');
$signature = strtolower((string) ($_SERVER['HTTP_X_RELAY_SIGNATURE'] ?? ''));
if (preg_match('/^[0-9]{9,11}$/', $timestamp) !== 1 || preg_match('/^[0-9a-f]{64}$/', $signature) !== 1) {
    relay_fail(401, 'unauthorized', 'missing or malformed signature headers from ' . $remoteIp);
}
$expected = hash_hmac('sha256', $timestamp . '.' . $body, RELAY_SECRET);
if (!hash_equals($expected, $signature)) {
    relay_fail(401, 'unauthorized', 'bad signature from ' . $remoteIp);
}
if (abs(time() - (int) $timestamp) > MAX_SKEW_SECONDS) {
    relay_fail(401, 'request expired', 'timestamp outside the 5-minute window from ' . $remoteIp);
}

// ---------------------------------------------------------------------------
// 5. Validate the message
// ---------------------------------------------------------------------------
$data = json_decode($body, true);
if (!is_array($data)) {
    relay_fail(400, 'body must be a JSON object');
}
$allowedKeys = ['id', 'to', 'subject', 'html', 'text', 'from', 'fromName'];
foreach (array_keys($data) as $key) {
    if (!in_array($key, $allowedKeys, true)) {
        relay_fail(400, 'unexpected field');
    }
}

$to = $data['to'] ?? null;
if (!is_string($to) || strlen($to) > 254 || relay_has_controls($to)
    || filter_var($to, FILTER_VALIDATE_EMAIL) === false) {
    relay_fail(400, 'invalid recipient (exactly one plain email address required)');
}

$subject = $data['subject'] ?? null;
if (!is_string($subject) || trim($subject) === '' || relay_has_controls($subject)
    || strlen($subject) > MAX_SUBJECT_LEN * 4 || preg_match('//u', $subject) !== 1
    || (function_exists('mb_strlen') ? mb_strlen($subject, 'UTF-8') : strlen($subject)) > MAX_SUBJECT_LEN) {
    relay_fail(400, 'invalid subject');
}

$html = $data['html'] ?? '';
$text = $data['text'] ?? '';
if (!is_string($html) || !is_string($text)) {
    relay_fail(400, 'html and text must be strings');
}
if (strlen($html) > MAX_HTML_BYTES || strlen($text) > MAX_TEXT_BYTES) {
    relay_fail(413, 'message too large');
}
if (trim($html) === '' && trim($text) === '') {
    relay_fail(400, 'message body required');
}
if (preg_match('//u', $html) !== 1 || preg_match('//u', $text) !== 1) {
    relay_fail(400, 'body must be UTF-8');
}

if (isset($data['from']) && (!is_string($data['from']) || strcasecmp($data['from'], FROM_ADDRESS) !== 0)) {
    relay_fail(400, 'sender not allowed', 'rejected sender ' . (is_string($data['from']) ? substr($data['from'], 0, 100) : '?'));
}

$fromName = $data['fromName'] ?? FROM_NAME;
if (!is_string($fromName) || relay_has_controls($fromName) || strlen($fromName) > MAX_NAME_LEN * 4
    || preg_match('//u', $fromName) !== 1) {
    relay_fail(400, 'invalid sender name');
}
if (trim($fromName) === '') {
    $fromName = FROM_NAME;
}

if (isset($data['id']) && (!is_string($data['id']) || preg_match('/^[A-Za-z0-9-]{1,64}$/', $data['id']) !== 1)) {
    relay_fail(400, 'invalid id');
}

// ---------------------------------------------------------------------------
// 6. Replay protection + hourly cap (file-locked state, outside the web root)
// ---------------------------------------------------------------------------
$stateDir = relay_state_dir();
if (!is_dir($stateDir) && !@mkdir($stateDir, 0700, true)) {
    relay_fail(500, 'relay state unavailable', 'cannot create state directory ' . $stateDir);
}
$lockHandle = @fopen($stateDir . '/state.lock', 'c');
if ($lockHandle === false || !flock($lockHandle, LOCK_EX)) {
    relay_fail(500, 'relay state unavailable', 'cannot lock ' . $stateDir . '/state.lock');
}
$statePath = $stateDir . '/state.json';
$now       = time();
$raw       = is_file($statePath) ? (string) @file_get_contents($statePath) : '';
$state     = json_decode($raw, true);
if (!is_array($state)) {
    $state = [];
}
$sends = isset($state['sends']) && is_array($state['sends']) ? $state['sends'] : [];
$seen  = isset($state['seen'])  && is_array($state['seen'])  ? $state['seen']  : [];

$sends = array_values(array_filter($sends, function ($t) use ($now) {
    return is_int($t) && $t > $now - 3600;
}));
foreach ($seen as $sig => $expiresAt) {
    if (!is_int($expiresAt) || $expiresAt < $now) {
        unset($seen[$sig]);
    }
}

if (isset($seen[$signature])) {
    flock($lockHandle, LOCK_UN);
    relay_fail(409, 'duplicate request', 'replayed signature from ' . $remoteIp);
}
if (count($sends) >= MAX_PER_HOUR) {
    flock($lockHandle, LOCK_UN);
    relay_fail(429, 'hourly send limit reached', 'hourly cap of ' . MAX_PER_HOUR . ' reached');
}

// Consume the signature and count the attempt BEFORE sending.
$seen[$signature] = $now + (2 * MAX_SKEW_SECONDS);
$sends[]          = $now;
$written = @file_put_contents($statePath, json_encode(['sends' => $sends, 'seen' => $seen]), LOCK_EX);
flock($lockHandle, LOCK_UN);
fclose($lockHandle);
if ($written === false) {
    relay_fail(500, 'relay state unavailable', 'cannot write ' . $statePath);
}

// ---------------------------------------------------------------------------
// 7. Build and send the message
// ---------------------------------------------------------------------------
$domain    = substr((string) strrchr(FROM_ADDRESS, '@'), 1);
$messageId = bin2hex(random_bytes(16)) . '@' . $domain;
$boundary  = 'ii_' . bin2hex(random_bytes(12));

$headers = [
    'From: ' . relay_encode_header($fromName) . ' <' . FROM_ADDRESS . '>',
    'Reply-To: ' . FROM_ADDRESS,
    'Message-ID: <' . $messageId . '>',
    'Date: ' . date('r'),
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
];

$parts = [];
if (trim($text) !== '') {
    $parts[] = "Content-Type: text/plain; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($text), 76, "\r\n");
}
if (trim($html) !== '') {
    $parts[] = "Content-Type: text/html; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($html), 76, "\r\n");
}
$message = '';
foreach ($parts as $part) {
    $message .= '--' . $boundary . "\r\n" . $part;
}
$message .= '--' . $boundary . "--\r\n";

// The 5th argument sets the envelope sender (Return-Path) so bounces and SPF
// alignment use the real mailbox instead of the cPanel account's system user.
$sent = mail($to, relay_encode_header($subject), $message, implode("\r\n", $headers), '-f' . FROM_ADDRESS);

if (!$sent) {
    $last = error_get_last();
    relay_fail(502, 'local mail system refused the message',
        'mail() returned false' . ($last ? ': ' . $last['message'] : ''));
}

relay_respond(200, ['ok' => true, 'messageId' => $messageId]);
