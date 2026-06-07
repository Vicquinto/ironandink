(function () {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebarToggle');

  if (!sidebar || !toggle) return;

  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    sidebar.classList.add('collapsed');
  }

  toggle.addEventListener('click', function () {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
  });
})();
