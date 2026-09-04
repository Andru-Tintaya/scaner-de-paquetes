/**
 * PARSER - Parseo de tickets OCR
 */

const Parser = {
    KEYWORDS_DETALLE: ['FRAGIL', 'FRÁGIL', 'ROPA', 'VAJILLA', 'JUGUETES', 'ELECTRONICOS', 'ELECTRÓNICOS', 'CABLES', 'DELICADO', 'ZAPATOS', 'LIBROS', 'ALIMENTOS', 'DOCUMENTOS'],
    KEYWORDS_TIENDA: ['MEDIA LUNA', 'MEDIALUNA'],

    parseTicketData(rawText) {
        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const fullText = rawText.toUpperCase();

        let codigo = null,
            cliente_nombre = null,
            cliente_celular = null,
            detalle = null,
            fecha_ticket = null,
            tienda = null;
        let codigoLineIdx = -1;

        // --- CÓDIGO ---
        for (let i = 0; i < lines.length; i++) {
            const candidate = normalizeCodigo(lines[i]);
            if (esCodigoValido(candidate)) {
                codigo = candidate;
                codigoLineIdx = i;
                break;
            }
        }
        if (!codigo) {
            const m = fullText.match(/\b([A-Z])\s*[-\s]?\s*(\d{1,4})\b/);
            if (m) {
                const cand = normalizeCodigo(m[1] + m[2]);
                if (esCodigoValido(cand)) codigo = cand;
            }
        }
        if (!codigo) {
            for (const line of lines) {
                const clean = line.replace(/[^A-Z0-9]/g, '');
                if (clean.length >= 2 && clean.length <= 5 && /^[A-Z]/.test(clean)) {
                    const cand = normalizeCodigo(clean);
                    if (esCodigoValido(cand)) { codigo = cand; break; }
                }
            }
        }

        // --- FECHA ---
        const fechaMatch = rawText.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})(\s+\d{1,2}:\d{2})?\b/);
        if (fechaMatch) fecha_ticket = fechaMatch[1] + (fechaMatch[2] || '');

        // --- TIENDA ---
        for (const kw of this.KEYWORDS_TIENDA) {
            if (fullText.includes(kw)) { tienda = 'MEDIA LUNA'; break; }
        }

        // --- DETALLE ---
        const detalleLabel = rawText.match(/detalle\s*:?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,30})/i);
        if (detalleLabel) {
            detalle = detalleLabel[1].trim();
        } else {
            for (const kw of this.KEYWORDS_DETALLE) {
                if (fullText.includes(kw)) { detalle = kw; break; }
            }
        }

        // --- CELULAR ---
        const celMatch = rawText.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '').match(/\b\d{7,10}\b/);
        if (celMatch) cliente_celular = celMatch[0];

        // --- NOMBRE ---
        const isNoise = (line) => {
            const up = line.toUpperCase();
            if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) return true;
            if (this.KEYWORDS_TIENDA.some(kw => up.includes(kw))) return true;
            if (/^DETALLE/i.test(line)) return true;
            if (/^\d{7,10}$/.test(line.replace(/\s/g, ''))) return true;
            if (esCodigoValido(normalizeCodigo(line))) return true;
            return false;
        };

        for (let i = (codigoLineIdx >= 0 ? codigoLineIdx + 1 : 0); i < lines.length; i++) {
            if (!isNoise(lines[i]) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(lines[i])) {
                let nombre = lines[i].replace(/\s+/g, ' ').trim();
                nombre = capitalizar(nombre);
                cliente_nombre = nombre;
                break;
            }
        }
        if (!cliente_nombre) {
            for (const line of lines) {
                if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ\s]{3,}$/.test(line) && !isNoise(line)) {
                    cliente_nombre = capitalizar(line.trim());
                    break;
                }
            }
        }

        return { codigo, cliente_nombre, cliente_celular, detalle, fecha_ticket, tienda };
    },

    parseQRData(text) {
        const parts = text.split('|');
        if (parts.length < 2) return null;
        return {
            codigo: normalizeCodigo(parts[0] || ''),
            cliente_nombre: capitalizar((parts[1] || '').trim()),
            cliente_celular: (parts[2] || '').trim() || null,
            detalle: (parts[3] || '').trim() || null,
            fecha_ticket: (parts[4] || '').trim() || null,
            tienda: (parts[5] || '').trim() || 'MEDIA LUNA'
        };
    }
};