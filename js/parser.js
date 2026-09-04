/**
 * PARSER - Parseo de tickets OCR con corrección de código gigante
 */

const Parser = {
    // Palabras clave para detección
    KEYWORDS_DETALLE: [
        'FRAGIL', 'FRÁGIL', 'ROPA', 'VAJILLA', 'JUGUETES',
        'ELECTRONICOS', 'ELECTRÓNICOS', 'CABLES', 'DELICADO',
        'ZAPATOS', 'LIBROS', 'ALIMENTOS', 'DOCUMENTOS',
        'MUEBLES', 'HERRAMIENTAS', 'COSMETICOS', 'MEDICAMENTOS'
    ],

    KEYWORDS_TIENDA: ['MEDIA LUNA', 'MEDIALUNA'],

    // Parsear texto del ticket
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

        // -------- ESTRATEGIAS PARA DETECTAR CÓDIGO --------
        // 1. Buscar patrón en líneas completas
        for (let i = 0; i < lines.length; i++) {
            const candidate = normalizeCodigo(lines[i]);
            if (esCodigoValido(candidate)) {
                codigo = candidate;
                codigoLineIdx = i;
                break;
            }
        }

        // 2. Buscar en todo el texto
        if (!codigo) {
            const m = fullText.match(/\b([A-Z])\s*[-\s]?\s*(\d{1,4})\b/);
            if (m) {
                const cand = normalizeCodigo(m[1] + m[2]);
                if (esCodigoValido(cand)) codigo = cand;
            }
        }

        // 3. Buscar en líneas cortas
        if (!codigo) {
            for (const line of lines) {
                const clean = line.replace(/[^A-Z0-9]/g, '');
                if (clean.length >= 2 && clean.length <= 5 && /^[A-Z]/.test(clean)) {
                    const cand = normalizeCodigo(clean);
                    if (esCodigoValido(cand)) {
                        codigo = cand;
                        codigoLineIdx = lines.indexOf(line);
                        break;
                    }
                }
            }
        }

        // 4. Buscar líneas con "CÓDIGO:" explícito
        if (!codigo) {
            const m = fullText.match(/C[ÓO]DIGO\s*:?\s*([A-Z0-9]{2,5})/);
            if (m) {
                const cand = normalizeCodigo(m[1]);
                if (esCodigoValido(cand)) codigo = cand;
            }
        }

        // -------- FECHA --------
        const fechaMatch = rawText.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})(\s+\d{1,2}:\d{2})?\b/);
        if (fechaMatch) fecha_ticket = fechaMatch[1] + (fechaMatch[2] || '');

        // -------- TIENDA --------
        for (const kw of this.KEYWORDS_TIENDA) {
            if (fullText.includes(kw)) { tienda = 'MEDIA LUNA'; break; }
        }

        // -------- DETALLE --------
        const detalleLabel = rawText.match(/detalle\s*:?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,30})/i);
        if (detalleLabel) {
            detalle = detalleLabel[1].trim().toUpperCase();
        } else {
            for (const kw of this.KEYWORDS_DETALLE) {
                if (fullText.includes(kw)) { detalle = kw; break; }
            }
        }

        // -------- CELULAR --------
        const celMatch = rawText.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '').match(/\b\d{7,10}\b/);
        if (celMatch) cliente_celular = celMatch[0];

        // -------- NOMBRE --------
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

        // Fallback: buscar cualquier línea con solo letras
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

    // Parsear QR (formato: codigo|nombre|celular|detalle|fecha|tienda)
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