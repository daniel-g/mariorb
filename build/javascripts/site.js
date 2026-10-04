// This is where it all goes :)
document.addEventListener('DOMContentLoaded', function() {

  // Email obfuscation
  document.querySelectorAll('.email-link').forEach(function(el) {
    var addr = el.dataset.n + '@' + el.dataset.d;
    el.textContent = addr;
    el.href = 'mailto:' + addr;
  });

  // Mobile menu: the navbar uses Bootstrap's collapse markup, but Bootstrap's JS is
  // not loaded, so the toggler button opens and closes the menu here
  document.querySelectorAll('.navbar-toggler').forEach(function(btn) {
    var menu = document.querySelector(btn.dataset.target);
    if (!menu) return;
    btn.addEventListener('click', function() {
      var open = menu.classList.toggle('show');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // Publication category filter
  var filterBtns = document.querySelectorAll('.pub-filter-btn[data-filter]');
  if (!filterBtns.length) return;

  var allCards = document.querySelectorAll('#publications .card, #other-work .card');
  var sections = ['publications', 'other-work'];

  function applyFilter(active) {
    allCards.forEach(function(card) {
      var cats = (card.dataset.cat || '').split(' ').filter(Boolean);
      var show = !active || cats.indexOf(active) !== -1;
      if (show) card.classList.remove('pub-hidden');
      else card.classList.add('pub-hidden');
    });
    sections.forEach(function(id) {
      var sec = document.getElementById(id);
      if (!sec) return;
      var hasVisible = sec.querySelectorAll('.card:not(.pub-hidden)').length > 0;
      if (hasVisible) sec.classList.remove('pub-hidden');
      else sec.classList.add('pub-hidden');
    });
  }

  // The "All" pill has an empty data-filter; pressing the active pill again goes back to it
  function select(btn) {
    filterBtns.forEach(function(b) {
      var on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    applyFilter(btn.dataset.filter || null);
  }

  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var wasActive = btn.classList.contains('active');
      select(wasActive ? filterBtns[0] : btn);
    });
  });

  // research.html#scaling (or #effective, #populations, #other) opens with that filter on
  var initial = location.hash.slice(1);
  var start = filterBtns[0];
  filterBtns.forEach(function(btn) {
    if (initial && btn.dataset.filter === initial) start = btn;
  });
  select(start);

});
