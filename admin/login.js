const params = new URLSearchParams(window.location.search);
const error = params.get('error');
const banner = document.getElementById('error-banner');
const input  = document.getElementById('password');

if (error === 'wrong') {
    banner.textContent = 'Incorrect password. Please try again.';
    banner.classList.add('visible');
    input.classList.add('shake');
    input.addEventListener('animationend', () => input.classList.remove('shake'), { once: true });
} else if (error === 'rate') {
    banner.textContent = 'Too many failed attempts. Please wait one minute and try again.';
    banner.classList.add('visible');
}

if (error) {
    history.replaceState(null, '', '/admin/login');
}
