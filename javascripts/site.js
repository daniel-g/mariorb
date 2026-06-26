// This is where it all goes :)
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.email-link').forEach(function(el) {
    var addr = el.dataset.n + '@' + el.dataset.d;
    el.textContent = addr;
    el.href = 'mailto:' + addr;
  });
});
