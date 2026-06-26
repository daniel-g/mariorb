// This is where it all goes :)
document.addEventListener('DOMContentLoaded', function() {

  // Email obfuscation
  document.querySelectorAll('.email-link').forEach(function(el) {
    var addr = el.dataset.n + '@' + el.dataset.d;
    el.textContent = addr;
    el.href = 'mailto:' + addr;
  });

  // Publication category filter
  var filterBtns = document.querySelectorAll('.pub-filter-btn');
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

  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var wasActive = btn.classList.contains('active');
      filterBtns.forEach(function(b) { b.classList.remove('active'); });
      if (wasActive) {
        applyFilter(null);
      } else {
        btn.classList.add('active');
        applyFilter(btn.dataset.filter);
      }
    });
  });

});
