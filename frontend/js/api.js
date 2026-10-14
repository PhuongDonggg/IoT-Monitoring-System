// API chung. Giữ nguyên HTML/CSS của dự án; chỉ thay lớp dữ liệu demo.
const iotApi = {
  token: () => sessionStorage.getItem('iotToken'),
  async request(url, options = {}) {
    const headers = {...(options.headers || {})};
    if (iotApi.token()) headers.Authorization = 'Bearer ' + iotApi.token();
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    let response;
    try { response = await fetch(url, {...options, headers}); }
    catch { throw new Error('Không kết nối được Backend. Kiểm tra npm start.'); }
    if (response.status === 401 && !url.endsWith('/auth/login')) {
      sessionStorage.removeItem('iotToken');
      sessionStorage.removeItem('iotUser');
      window.location.replace('index.html');
      throw new Error('Phiên đăng nhập hết hạn');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
    return data;
  },
  socket() {
    if (typeof io !== 'function' || !iotApi.token()) return null;
    return io({auth: {token: iotApi.token()}, reconnection: true});
  },
  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  }
};
