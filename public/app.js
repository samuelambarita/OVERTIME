document.addEventListener('change', function (e) {
  var box = e.target;
  if (!box.matches || !box.matches('input[type=checkbox][data-select-all]')) return;
  var form = box.closest('form');
  if (!form) return;
  form.querySelectorAll('input[name=ids]').forEach(function (cb) { cb.checked = box.checked; });
});

// Pilih anggota pengajuan kelompok: tombol hasil pencarian menambah chip + input tersembunyi.
document.addEventListener('click', function (e) {
  var t = e.target;
  if (!t.closest) return;
  var add = t.closest('[data-add-member]');
  if (add) {
    var chips = document.getElementById('member-chips');
    if (!chips) return;
    var id = add.getAttribute('data-id');
    if (chips.querySelector('[data-chip="' + id + '"]')) return;
    var chip = document.createElement('span');
    chip.className = 'chip';
    chip.setAttribute('data-chip', id);
    chip.appendChild(document.createTextNode(add.getAttribute('data-name') + ' '));
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'memberIds';
    input.value = id;
    chip.appendChild(input);
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'chip-remove';
    rm.setAttribute('data-remove-member', '');
    rm.setAttribute('aria-label', 'Hapus ' + add.getAttribute('data-name'));
    rm.textContent = '\u00d7';
    chip.appendChild(rm);
    chips.appendChild(chip);
    var typeSel = document.querySelector('select[name=type]');
    if (typeSel) typeSel.value = 'GROUP';
    chips.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  var remove = t.closest('[data-remove-member]');
  if (remove) {
    var c = remove.closest('.chip');
    var parent = c.parentNode;
    c.remove();
    parent.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

// Kolom cari anggota bukan bagian dari form: Enter tidak mengirim form, change tidak memicu /cek.
document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-member-search]')) e.preventDefault();
}, true);
document.addEventListener('change', function (e) {
  if (e.target.matches && e.target.matches('[data-member-search]')) e.stopPropagation();
}, true);
