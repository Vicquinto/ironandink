(function (global) {
  'use strict';

  function buildModal(message, buttons) {
    var overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:rgba(0,0,0,0.6)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    var card = document.createElement('div');
    card.style.cssText = [
      'background:#2A1A0F',
      'border:1px solid #7A5C3B',
      'border-radius:8px',
      'padding:2rem',
      'max-width:420px',
      'width:90%',
      'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
    ].join(';');

    var msg = document.createElement('p');
    msg.textContent = message;
    msg.style.cssText = [
      'color:#F7F0E0',
      'font-family:Georgia,serif',
      'font-size:1rem',
      'line-height:1.55',
      'text-align:center',
      'margin-bottom:1.5rem',
    ].join(';');

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;justify-content:center;flex-wrap:wrap;';

    buttons.forEach(function (def) {
      var btn = document.createElement('button');
      btn.textContent = def.label;
      if (def.primary) {
        btn.style.cssText = [
          'background:#B38C33',
          'color:#1A0F0A',
          'font-weight:600',
          'border:none',
          'font-family:Georgia,serif',
          'font-size:0.9rem',
          'padding:8px 22px',
          'border-radius:4px',
          'cursor:pointer',
        ].join(';');
      } else {
        btn.style.cssText = [
          'background:transparent',
          'color:#F7F0E0',
          'border:1px solid #7A5C3B',
          'font-family:Georgia,serif',
          'font-size:0.9rem',
          'padding:8px 22px',
          'border-radius:4px',
          'cursor:pointer',
        ].join(';');
      }
      btn.addEventListener('click', function () {
        document.body.removeChild(overlay);
        if (def.onClick) def.onClick();
      });
      row.appendChild(btn);
    });

    card.appendChild(msg);
    card.appendChild(row);
    overlay.appendChild(card);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        var cancel = buttons.find(function (b) { return !b.primary; });
        if (cancel && cancel.onClick) cancel.onClick();
      }
    });

    document.body.appendChild(overlay);
  }

  global.showConfirm = function (message, confirmLabel, onConfirm, onCancel) {
    buildModal(message, [
      { label: confirmLabel || 'Confirm', primary: true,  onClick: onConfirm },
      { label: 'Cancel',                  primary: false, onClick: onCancel  },
    ]);
  };

  global.showAlert = function (message, onClose) {
    buildModal(message, [
      { label: 'OK', primary: true, onClick: onClose },
    ]);
  };

}(window));
