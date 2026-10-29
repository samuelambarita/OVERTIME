document.addEventListener('change', function (e) {
  var box = e.target;
  if (!box.matches || !box.matches('input[type=checkbox][data-select-all]')) return;
  var form = box.closest('form');
  if (!form) return;
  form.querySelectorAll('input[name=ids]').forEach(function (cb) { cb.checked = box.checked; });
});
