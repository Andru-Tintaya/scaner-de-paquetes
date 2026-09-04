/**
 * UTILIDADES - Funciones genéricas reutilizables
 */

// Formatear moneda
function fmtMoney(n, cfg) {
    cfg = cfg || Config.getConfig();
    return (cfg.moneda || 'Bs') + ' ' + (Math.round(n * 100) / 100).toFixed(2);
}

// Formatear fecha
function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// Formatear fecha corta
function fmtDateShort(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
}

// Pad con cero
function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

// Días entre dos fechas
function daysBetween(iso, ref) {
    const a = new Date(iso);
    const b = ref ? new Date(ref) : new Date();
    return Math.floor((b - a) / 86400000);
}

// Mostrar toast
function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast';
    if (type === 'error') t.style.borderColor = '#dc3545';
    if (type === 'success') t.style.borderColor = '#28a745';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
}

// Generar ID aleatorio
function generarId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Capitalizar texto
function capitalizar(texto) {
    if (!texto) return '';
    return texto.split(' ').map(w =>
        w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w
    ).join(' ');
}

// Normalizar código OCR
function normalizeCodigo(raw) {
    if (!raw) return '';
    let c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const m = c.match(/^([A-Z])([A-Z0-9]+)$/);
    if (!m) return c;
    const letter = m[1];
    let digits = m[2];
    const map = {
        'O': '0', 'Q': '0', 'D': '0',
        'I': '1', 'L': '1', 'T': '1',
        'Z': '2', 'S': '5', 'B': '8',
        'G': '6', 'A': '4', 'E': '3',
        'H': '4', 'K': '1', 'M': '1',
        'N': '1', 'V': '1', 'W': '1',
        'P': '9', 'R': '2', 'Y': '4'
    };
    digits = digits.split('').map(ch =>
        /[0-9]/.test(ch) ? ch : (map[ch] !== undefined ? map[ch] : ch)
    ).join('');
    return letter + digits;
}

// Validar código
function esCodigoValido(c) {
    return /^[A-Z]\d{1,4}$/.test(c);
}

// Validar celular (Bolivia)
function esCelularValido(cel) {
    return /^[6-9]\d{7}$/.test(cel.replace(/\D/g, ''));
}

// Validar fecha
function esFechaValida(str) {
    return /\d{1,2}\/\d{1,2}\/\d{2,4}(\s+\d{1,2}:\d{2})?/.test(str);
}