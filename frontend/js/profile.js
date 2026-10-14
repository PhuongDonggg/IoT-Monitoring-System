setActivePage('profile');
document.querySelectorAll('[data-placeholder]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    alert(link.dataset.placeholder + ' link chưa được cấu hình. Khi có URL thật, thay href="#" trong profile.html.');
  });
});
