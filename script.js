/**
 * MEDIA LUNA — CONTROL DE PAQUETERÍA
 * Versión completa con CRUD, OCR, QR y configuración
 */

(function() {
    "use strict";

    // ============================================================
    // BASE DE DATOS LOCAL (localStorage)
    // ============================================================
    const DB = {
        KEYS: { PAQ: 'ml_paquetes', CFG: 'ml_config', MOV: 'ml_movimientos', SEQ: 'ml_seq' },

        read(key, fallback) {
            try {
                const v = localStorage.getItem(key);
                return v ? JSON.parse(v) : fallback;
            } catch (e) {
                return fallback;
            }
        },

        write(key, val) {
            localStorage.setItem(key, JSON.stringify(val));
        },

        nextId() {
            let seq = this.read(this.KEYS.SEQ, 0) + 1;
            this.write(this.KEYS.SEQ, seq);
            return seq;
        },

        getPaquetes() {
            return this.read(this.KEYS.PAQ, []);
        },

        savePaquetes(arr) {
            this.write(this.KEYS.PAQ, arr);
        },

        getConfig() {
            return this.read(this.KEYS.CFG, {
                moneda: 'Bs',
                precio_base: 3.00,
                dias_gratis: 5,
                recargo_diario: 0.50
            });
        },

        saveConfig(cfg) {
            this.write(this.KEYS.CFG, cfg);
        },

        logMovimiento(paquete_id, accion, detalle) {
            const mov = this.read(this.KEYS.MOV, []);
            mov.push({
                id: this.nextId(),
                paquete_id,
                accion,
                fecha: new Date().toISOString(),
                detalle: detalle || ''
            });
            this.write(this.KEYS.MOV, mov);
        },

        // ============================================================
        // CRUD COMPLETO
        // ============================================================
        crearPaquete(datos) {
            const paquetes = this.getPaquetes();
            const cfg = this.getConfig();

            // Verificar si ya existe un paquete pendiente con el mismo código
            const existe = paquetes.find(p => p.codigo === datos.codigo && p.estado === 'pendiente');
            if (existe) {
                return { success: false, error: 'Ya existe un paquete pendiente con este código', paquete: existe };
            }

            const nuevo = {
                id: this.nextId(),
                codigo: datos.codigo.toUpperCase(),
                cliente_nombre: datos.cliente_nombre,
                cliente_celular: datos.cliente_celular || null,
                detalle: datos.detalle || null,
                quien_dejo: datos.quien_dejo || null,
                fecha_ticket: datos.fecha_ticket || null,
                fecha_ingreso: new Date().toISOString(),
                fecha_entrega: null,
                precio_base: cfg.precio_base,
                deuda_final: null,
                monto_pagado: null,
                estado: 'pendiente',
                tienda: 'MEDIA LUNA',
                qr_token: 'PKG-' + Math.random().toString(36).slice(2, 10).toUpperCase()
            };

            paquetes.push(nuevo);
            this.savePaquetes(paquetes);
            this.logMovimiento(nuevo.id, 'REGISTRO', 'Registrado');
            return { success: true, paquete: nuevo };
        },

        obtenerPaquete(id) {
            const paquetes = this.getPaquetes();
            return paquetes.find(p => p.id === id) || null;
        },

        obtenerPaquetes(filtro) {
            let paquetes = this.getPaquetes();
            if (filtro && filtro !== 'todos') {
                paquetes = paquetes.filter(p => p.estado === filtro);
            }
            return paquetes;
        },

        buscarPaquetes(query) {
            const q = query.toLowerCase().trim();
            if (!q) return this.getPaquetes();
            return this.getPaquetes().filter(p =>
                p.codigo.toLowerCase().includes(q) ||
                p.cliente_nombre.toLowerCase().includes(q) ||
                (p.cliente_celular || '').includes(q)
            );
        },

        actualizarPaquete(id, datos) {
            const paquetes = this.getPaquetes();
            const p = paquetes.find(x => x.id === id);
            if (!p) return { success: false, error: 'Paquete no encontrado' };

            // Verificar código duplicado si se cambió
            if (datos.codigo && datos.codigo !== p.codigo) {
                const existe = paquetes.find(x =>
                    x.codigo === datos.codigo &&
                    x.estado === 'pendiente' &&
                    x.id !== id
                );
                if (existe) {
                    return { success: false, error: 'Ya existe otro paquete pendiente con este código' };
                }
                p.codigo = datos.codigo.toUpperCase();
            }

            if (datos.cliente_nombre) p.cliente_nombre = datos.cliente_nombre;
            if (datos.cliente_celular !== undefined) p.cliente_celular = datos.cliente_celular || null;
            if (datos.detalle !== undefined) p.detalle = datos.detalle || null;
            if (datos.quien_dejo !== undefined) p.quien_dejo = datos.quien_dejo || null;
            if (datos.fecha_ticket !== undefined) p.fecha_ticket = datos.fecha_ticket || null;

            p.updated_at = new Date().toISOString();
            this.savePaquetes(paquetes);
            this.logMovimiento(id, 'EDICION', 'Datos actualizados');
            return { success: true, paquete: p };
        },

        entregarPaquete(id, montoPagado) {
            const paquetes = this.getPaquetes();
            const p = paquetes.find(x => x.id === id);
            if (!p) return { success: false, error: 'Paquete no encontrado' };
            if (p.estado === 'entregado') return { success: false, error: 'El paquete ya fue entregado' };

            const cfg = this.getConfig();
            const deuda = this.calcularDeuda(p, cfg);

            p.estado = 'entregado';
            p.fecha_entrega = new Date().toISOString();
            p.deuda_final = deuda;
            p.monto_pagado = montoPagado || deuda;

            this.savePaquetes(paquetes);
            this.logMovimiento(id, 'ENTREGA', 'Monto pagado: ' + (montoPagado || deuda));
            return { success: true, paquete: p };
        },

        eliminarPaquete(id) {
            let paquetes = this.getPaquetes();
            const p = paquetes.find(x => x.id === id);
            if (!p) return { success: false, error: 'Paquete no encontrado' };

            paquetes = paquetes.filter(x => x.id !== id);
            this.savePaquetes(paquetes);
            this.logMovimiento(id, 'ELIMINACION', 'Paquete eliminado');
            return { success: true };
        },

        calcularDeuda(paquete, cfg) {
            cfg = cfg || this.getConfig();
            const dias = Math.max(0, this._diasEntre(paquete.fecha_ingreso));
            let deuda = Number(cfg.precio_base);
            if (dias > Number(cfg.dias_gratis)) {
                const extra = dias - Number(cfg.dias_gratis);
                deuda += extra * Number(cfg.recargo_diario);
            }
            return Math.round(deuda * 100) / 100;
        },

        _diasEntre(iso, ref) {
            const a = new Date(iso);
            const b = ref ? new Date(ref) : new Date();
            return Math.floor((b - a) / 86400000);
        }
    };

    // ============================================================
    // UTILIDADES
    // ============================================================
    function fmtMoney(n, cfg) {
        cfg = cfg || DB.getConfig();
        return (cfg.moneda || 'Bs') + ' ' + (Math.round(n * 100) / 100).toFixed(2);
    }

    function pad2(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    function daysBetween(iso, ref) {
        const a = new Date(iso);
        const b = ref ? new Date(ref) : new Date();
        return Math.floor((b - a) / 86400000);
    }

    function toast(msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2400);
    }

    // ============================================================
    // CORRECCIÓN OCR
    // ============================================================
    function normalizeCodigo(raw) {
        if (!raw) return '';
        let c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const m = c.match(/^([A-Z])([A-Z0-9]+)$/);
        if (!m) return c;
        const letter = m[1];
        let digits = m[2];
        const map = {
            'O': '0',
            'Q': '0',
            'D': '0',
            'I': '1',
            'L': '1',
            'T': '1',
            'Z': '2',
            'S': '5',
            'B': '8',
            'G': '6',
            'A': '4',
            'E': '3',
            'H': '4',
            'K': '1',
            'M': '1',
            'N': '1',
            'V': '1',
            'W': '1',
            'P': '9',
            'R': '2',
            'Y': '4'
        };
        digits = digits.split('').map(ch => /[0-9]/.test(ch) ? ch : (map[ch] !== undefined ? map[ch] : ch)).join('');
        return letter + digits;
    }

    function esCodigoValido(c) {
        return /^[A-Z]\d{1,4}$/.test(c);
    }

    // ============================================================
    // PARSER DEL TICKET
    // ============================================================
    const KEYWORDS_DETALLE = ['FRAGIL', 'FRÁGIL', 'ROPA', 'VAJILLA', 'JUGUETES', 'ELECTRONICOS', 'ELECTRÓNICOS', 'CABLES', 'DELICADO', 'ZAPATOS', 'LIBROS', 'ALIMENTOS', 'DOCUMENTOS'];
    const KEYWORDS_TIENDA = ['MEDIA LUNA', 'MEDIALUNA'];

    function parseTicketData(rawText) {
        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const fullText = rawText.toUpperCase();

        let codigo = null,
            cliente_nombre = null,
            cliente_celular = null,
            detalle = null,
            fecha_ticket = null,
            tienda = null;
        let codigoLineIdx = -1;

        // Estrategia 1: Buscar patrón en líneas completas
        for (let i = 0; i < lines.length; i++) {
            const candidate = normalizeCodigo(lines[i]);
            if (esCodigoValido(candidate)) {
                codigo = candidate;
                codigoLineIdx = i;
                break;
            }
        }

        // Estrategia 2: Buscar patrón dentro de todo el texto
        if (!codigo) {
            const m = fullText.match(/\b([A-Z])\s*[-\s]?\s*(\d{1,4})\b/);
            if (m) {
                const cand = normalizeCodigo(m[1] + m[2]);
                if (esCodigoValido(cand)) codigo = cand;
            }
        }

        // Estrategia 3: Buscar en líneas cortas
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

        // FECHA
        const fechaMatch = rawText.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})(\s+\d{1,2}:\d{2})?\b/);
        if (fechaMatch) fecha_ticket = fechaMatch[1] + (fechaMatch[2] || '');

        // TIENDA
        for (const kw of KEYWORDS_TIENDA) {
            if (fullText.includes(kw)) { tienda = 'MEDIA LUNA'; break; }
        }

        // DETALLE
        const detalleLabel = rawText.match(/detalle\s*:?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,30})/i);
        if (detalleLabel) {
            detalle = detalleLabel[1].trim();
        } else {
            for (const kw of KEYWORDS_DETALLE) {
                if (fullText.includes(kw)) { detalle = kw; break; }
            }
        }

        // CELULAR
        const celMatch = rawText.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '').match(/\b\d{7,10}\b/);
        if (celMatch) cliente_celular = celMatch[0];

        // NOMBRE
        const isNoise = (line) => {
            const up = line.toUpperCase();
            if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) return true;
            if (KEYWORDS_TIENDA.some(kw => up.includes(kw))) return true;
            if (/^DETALLE/i.test(line)) return true;
            if (/^\d{7,10}$/.test(line.replace(/\s/g, ''))) return true;
            if (esCodigoValido(normalizeCodigo(line))) return true;
            return false;
        };

        for (let i = (codigoLineIdx >= 0 ? codigoLineIdx + 1 : 0); i < lines.length; i++) {
            if (!isNoise(lines[i]) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(lines[i])) {
                let nombre = lines[i].replace(/\s+/g, ' ').trim();
                nombre = nombre.split(' ').map(w => w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
                cliente_nombre = nombre;
                break;
            }
        }

        if (!cliente_nombre) {
            for (const line of lines) {
                if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ\s]{3,}$/.test(line) && !isNoise(line)) {
                    cliente_nombre = line.trim();
                    break;
                }
            }
        }

        return { codigo, cliente_nombre, cliente_celular, detalle, fecha_ticket, tienda };
    }

    // ============================================================
    // APP PRINCIPAL
    // ============================================================
    window.App = {
        currentView: 'scanner',
        scanMode: 'registro',
        scanType: 'ocr',
        filter: 'todos',
        camStream: null,
        currentDeviceId: null,
        availableCameras: [],
        ocrWorker: null,
        ocrTimer: null,
        ocrBusy: false,
        qrScanner: null,

        // ---------- Inicialización ----------
        init() {
            const cfg = DB.getConfig();
            document.getElementById('cfgMoneda').value = cfg.moneda;
            document.getElementById('cfgPrecioBase').value = cfg.precio_base;
            document.getElementById('cfgDiasGratis').value = cfg.dias_gratis;
            document.getElementById('cfgRecargo').value = cfg.recargo_diario;
            this.renderPaquetes();
            this.renderPublicSearch();
            this.updateHeaderStats();
            this.showView('scanner');
        },

        // ---------- Navegación ----------
        showView(name) {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('view-' + name).classList.add('active');
            ['navScanner', 'navPaquetes', 'navConsulta', 'navConfig'].forEach(id => document.getElementById(id).classList.remove('active'));
            const map = { scanner: 'navScanner', paquetes: 'navPaquetes', consulta: 'navConsulta', config: 'navConfig' };
            if (map[name]) document.getElementById(map[name]).classList.add('active');
            this.currentView = name;
            if (name !== 'scanner') this.stopCamera();
            if (name === 'paquetes') this.renderPaquetes();
        },

        // ---------- Selectores del escáner ----------
        setScanMode(m) {
            this.scanMode = m;
            document.getElementById('modeRegistro').classList.toggle('active', m === 'registro');
            document.getElementById('modeConsulta').classList.toggle('active', m === 'consulta');
            document.getElementById('scanResultBox').innerHTML = '';
        },

        setScanType(t) {
            if (this.camStream || this.qrScanner) this.stopCamera();
            this.scanType = t;
            document.getElementById('typeOcr').classList.toggle('active', t === 'ocr');
            document.getElementById('typeQr').classList.toggle('active', t === 'qr');
            document.getElementById('scanResultBox').innerHTML = '';
        },

        // ---------- Cámara OCR ----------
        async startCamera() {
            document.getElementById('scanResultBox').innerHTML = '';
            if (this.scanType === 'qr') { return this.startQr(); }

            try {
                const constraints = this.currentDeviceId ?
                    { video: { deviceId: { exact: this.currentDeviceId } } } :
                    { video: { facingMode: { ideal: 'environment' } } };
                this.camStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (e) {
                toast('❌ No se pudo acceder a la cámara: ' + e.message);
                return;
            }

            const video = document.getElementById('video');
            video.srcObject = this.camStream;
            video.style.display = 'block';
            document.getElementById('camPlaceholder').style.display = 'none';
            document.getElementById('camGuide').style.display = 'block';
            await video.play();

            document.getElementById('btnStartCam').style.display = 'none';
            document.getElementById('btnStopCam').style.display = 'inline-flex';

            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                this.availableCameras = devices.filter(d => d.kind === 'videoinput');
                document.getElementById('btnSwitchCam').style.display = this.availableCameras.length > 1 ? 'inline-flex' : 'none';
            } catch (e) {}

            this.setCamStatus('🔎 Escaneando ticket...', true);
            this.startOcrLoop();
        },

        async switchCamera() {
            if (!this.availableCameras.length) return;
            const idx = this.availableCameras.findIndex(d => d.deviceId === this.currentDeviceId);
            const next = this.availableCameras[(idx + 1) % this.availableCameras.length];
            this.currentDeviceId = next.deviceId;
            this.stopCamera(true);
            await this.startCamera();
        },

        stopCamera(keepResult) {
            if (this.camStream) {
                this.camStream.getTracks().forEach(t => t.stop());
                this.camStream = null;
            }
            if (this.ocrTimer) {
                clearInterval(this.ocrTimer);
                this.ocrTimer = null;
            }
            if (this.qrScanner) {
                this.qrScanner.stop().then(() => { try { this.qrScanner.clear(); } catch (e) {} }).catch(() => {});
                this.qrScanner = null;
            }
            const video = document.getElementById('video');
            video.style.display = 'none';
            video.srcObject = null;
            document.getElementById('qr-reader').style.display = 'none';
            document.getElementById('qr-reader').innerHTML = '';
            document.getElementById('camPlaceholder').style.display = 'block';
            document.getElementById('camGuide').style.display = 'none';
            document.getElementById('btnStartCam').style.display = 'inline-flex';
            document.getElementById('btnStopCam').style.display = 'none';
            document.getElementById('btnSwitchCam').style.display = 'none';
            this.setCamStatus('', false);
            if (!keepResult) document.getElementById('scanResultBox').innerHTML = '';
        },

        setCamStatus(msg, show) {
            const el = document.getElementById('camStatus');
            el.textContent = msg;
            el.classList.toggle('show', !!show);
        },

        async getOcrWorker() {
            if (!this.ocrWorker) {
                this.setCamStatus('⏳ Cargando motor OCR...', true);
                this.ocrWorker = await Tesseract.createWorker('spa');
            }
            return this.ocrWorker;
        },

        startOcrLoop() {
            if (this.ocrTimer) clearInterval(this.ocrTimer);
            this.ocrTimer = setInterval(() => { this.runOcrFrame(); }, 1800);
        },

        preprocessFrame(video) {
            const canvas = document.getElementById('ocrCanvas');
            const maxW = 1000;
            const scale = Math.min(2, maxW / video.videoWidth) || 1;
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
                let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                gray = (gray - 128) * 1.8 + 128;
                gray = Math.max(0, Math.min(255, gray));
                d[i] = d[i + 1] = d[i + 2] = gray;
            }
            ctx.putImageData(imgData, 0, 0);
            return canvas;
        },

        async runOcrFrame() {
            if (this.ocrBusy || !this.camStream) return;
            const video = document.getElementById('video');
            if (video.videoWidth === 0) return;
            this.ocrBusy = true;
            this.setCamStatus('🔎 Leyendo ticket...', true);

            try {
                const canvas = this.preprocessFrame(video);

                const estrategias = [
                    { escala: 1.0 },
                    { escala: 0.7 },
                    { escala: 0.5 },
                    { escala: 0.35 }
                ];

                let mejorCodigo = null;
                let mejorNombre = null;
                let mejorTexto = '';
                let mejorFechaLectura = null;

                for (const est of estrategias) {
                    if (this.ocrBusy === false) break;

                    const canvasTemp = document.createElement('canvas');
                    const w = Math.round(canvas.width * est.escala);
                    const h = Math.round(canvas.height * est.escala);
                    canvasTemp.width = w;
                    canvasTemp.height = h;
                    const ctxTemp = canvasTemp.getContext('2d');
                    ctxTemp.imageSmoothingEnabled = true;
                    ctxTemp.imageSmoothingQuality = 'high';
                    ctxTemp.drawImage(canvas, 0, 0, w, h);

                    const imgDataTemp = ctxTemp.getImageData(0, 0, w, h);
                    const dTemp = imgDataTemp.data;
                    for (let i = 0; i < dTemp.length; i += 4) {
                        let gray = 0.299 * dTemp[i] + 0.587 * dTemp[i + 1] + 0.114 * dTemp[i + 2];
                        const val = gray > 130 ? 255 : 0;
                        dTemp[i] = dTemp[i + 1] = dTemp[i + 2] = val;
                    }
                    ctxTemp.putImageData(imgDataTemp, 0, 0);

                    const result = await Tesseract.recognize(
                        canvasTemp.toDataURL('image/png'),
                        'spa+eng', {
                            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK
                        }
                    );
                    const texto = result.data.text;
                    const parsed = parseTicketData(texto);

                    if (parsed.codigo && parsed.cliente_nombre) {
                        mejorCodigo = parsed.codigo;
                        mejorNombre = parsed.cliente_nombre;
                        mejorTexto = texto;
                        if (parsed.fecha_ticket) mejorFechaLectura = parsed.fecha_ticket;
                        break;
                    } else if (parsed.codigo && !mejorCodigo) {
                        mejorCodigo = parsed.codigo;
                        mejorTexto = texto;
                    }
                }

                if (!mejorCodigo) {
                    const worker = await this.getOcrWorker();
                    const { data } = await worker.recognize(canvas);
                    const parsed = parseTicketData(data.text);
                    if (parsed.codigo && parsed.cliente_nombre) {
                        mejorCodigo = parsed.codigo;
                        mejorNombre = parsed.cliente_nombre;
                        mejorTexto = data.text;
                    }
                }

                if (mejorCodigo && mejorCodigo.length >= 2) {
                    if (!mejorNombre) {
                        const parsed = parseTicketData(mejorTexto);
                        mejorNombre = parsed.cliente_nombre;
                    }

                    clearInterval(this.ocrTimer);
                    this.ocrTimer = null;
                    this.setCamStatus('✅ Ticket leído', true);

                    const parsedFinal = parseTicketData(mejorTexto);
                    const resultado = {
                        codigo: mejorCodigo,
                        cliente_nombre: mejorNombre || parsedFinal.cliente_nombre,
                        cliente_celular: parsedFinal.cliente_celular,
                        detalle: parsedFinal.detalle,
                        fecha_ticket: parsedFinal.fecha_ticket || mejorFechaLectura,
                        tienda: parsedFinal.tienda || 'MEDIA LUNA'
                    };
                    this.handleParsedResult(resultado);
                } else {
                    this.setCamStatus('🔎 Escaneando...', true);
                }

            } catch (e) {
                console.error('OCR Error:', e);
                this.setCamStatus('⚠️ Error, acerca la cámara', true);
            } finally {
                this.ocrBusy = false;
            }
        },

        // ---------- Subir foto ----------
        async handleFileUpload(evt) {
            const file = evt.target.files[0];
            if (!file) return;
            if (this.scanType !== 'ocr') { toast('Cambia a modo OCR'); return; }
            this.setCamStatus('🔎 Leyendo imagen...', true);
            document.getElementById('camPlaceholder').style.display = 'none';

            try {
                const img = await createImageBitmap(file);
                const canvas = document.getElementById('ocrCanvas');
                const maxW = 1200;
                const scale = Math.min(2, maxW / img.width) || 1;
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const d = imgData.data;
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    gray = (gray - 128) * 1.8 + 128;
                    gray = Math.max(0, Math.min(255, gray));
                    d[i] = d[i + 1] = d[i + 2] = gray;
                }
                ctx.putImageData(imgData, 0, 0);

                let mejorParsed = null;
                const escalas = [1.0, 0.7, 0.5, 0.35];
                for (const esc of escalas) {
                    const canvasTemp = document.createElement('canvas');
                    canvasTemp.width = Math.round(canvas.width * esc);
                    canvasTemp.height = Math.round(canvas.height * esc);
                    const ctxTemp = canvasTemp.getContext('2d');
                    ctxTemp.imageSmoothingEnabled = true;
                    ctxTemp.imageSmoothingQuality = 'high';
                    ctxTemp.drawImage(canvas, 0, 0, canvasTemp.width, canvasTemp.height);

                    const imgTemp = ctxTemp.getImageData(0, 0, canvasTemp.width, canvasTemp.height);
                    const dTemp = imgTemp.data;
                    for (let i = 0; i < dTemp.length; i += 4) {
                        let gray = 0.299 * dTemp[i] + 0.587 * dTemp[i + 1] + 0.114 * dTemp[i + 2];
                        const val = gray > 130 ? 255 : 0;
                        dTemp[i] = dTemp[i + 1] = dTemp[i + 2] = val;
                    }
                    ctxTemp.putImageData(imgTemp, 0, 0);

                    const result = await Tesseract.recognize(
                        canvasTemp.toDataURL('image/png'),
                        'spa+eng', {
                            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK
                        }
                    );
                    const parsed = parseTicketData(result.data.text);
                    if (parsed.codigo && parsed.cliente_nombre) {
                        mejorParsed = parsed;
                        break;
                    } else if (parsed.codigo && !mejorParsed) {
                        mejorParsed = parsed;
                    }
                }

                this.setCamStatus('', false);
                if (mejorParsed && mejorParsed.codigo && mejorParsed.cliente_nombre) {
                    this.handleParsedResult(mejorParsed);
                } else {
                    toast('No se detectó código y nombre. Intenta con una foto más clara.');
                }
            } catch (e) {
                toast('Error: ' + e.message);
            }
            evt.target.value = '';
        },

        // ---------- QR Scanner ----------
        async startQr() {
            document.getElementById('video').style.display = 'none';
            document.getElementById('qr-reader').style.display = 'block';
            document.getElementById('camPlaceholder').style.display = 'none';
            document.getElementById('btnStartCam').style.display = 'none';
            document.getElementById('btnStopCam').style.display = 'inline-flex';
            this.setCamStatus('🔎 Apunta al QR...', true);

            this.qrScanner = new Html5Qrcode('qr-reader');
            try {
                await this.qrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 230 },
                    (decodedText) => { this.onQrSuccess(decodedText); },
                    () => {}
                );
            } catch (e) {
                toast('Error al iniciar QR: ' + e.message);
                this.stopCamera();
            }
        },

        onQrSuccess(text) {
            if (this.ocrBusy) return;
            this.ocrBusy = true;
            this.setCamStatus('✅ QR leído', true);
            if (this.qrScanner) { this.qrScanner.pause(true); }
            setTimeout(() => { this.ocrBusy = false; }, 1500);

            if (text.includes('|')) {
                const parts = text.split('|');
                const parsed = {
                    codigo: normalizeCodigo(parts[0] || ''),
                    cliente_nombre: (parts[1] || '').trim(),
                    cliente_celular: (parts[2] || '').trim() || null,
                    detalle: (parts[3] || '').trim() || null,
                    fecha_ticket: (parts[4] || '').trim() || null,
                    tienda: (parts[5] || '').trim() || null
                };
                if (!esCodigoValido(parsed.codigo) || !parsed.cliente_nombre) {
                    toast('QR no contiene datos válidos.');
                    if (this.qrScanner) this.qrScanner.resume();
                    return;
                }
                this.handleParsedResult(parsed);
            } else {
                const paquetes = DB.getPaquetes();
                const pkg = paquetes.find(p => p.qr_token === text);
                if (pkg) {
                    this.showExistingPackage(pkg);
                } else {
                    toast('QR no reconocido.');
                    if (this.qrScanner) this.qrScanner.resume();
                }
            }
        },

        // ---------- Flujo post-escaneo ----------
        handleParsedResult(parsed) {
            if (this.scanMode === 'consulta') {
                const paquetes = DB.getPaquetes();
                const existentes = paquetes.filter(p => p.codigo === parsed.codigo);
                const box = document.getElementById('scanResultBox');
                if (existentes.length === 0) {
                    box.innerHTML = '<div class="panel warn">No se encontró ningún paquete con código <b>' + parsed.codigo + '</b>.</div>';
                    return;
                }
                box.innerHTML = '<div class="scan-result"><h3>📦 Resultados para ' + parsed.codigo + '</h3></div>';
                existentes.sort((a, b) => b.fecha_ingreso.localeCompare(a.fecha_ingreso)).forEach(p => {
                    document.getElementById('scanResultBox').innerHTML += this.pkgCardHtml(p, true);
                });
                return;
            }

            // MODO REGISTRO - Usar CRUD
            const pendiente = DB.getPaquetes().find(p => p.codigo === parsed.codigo && p.estado === 'pendiente');
            if (pendiente) {
                this.showExistingPackage(pendiente);
            } else {
                this.showRegistrationForm(parsed);
            }
        },

        showExistingPackage(pkg) {
            const cfg = DB.getConfig();
            const deuda = DB.calcularDeuda(pkg, cfg);
            const box = document.getElementById('scanResultBox');
            box.innerHTML = `
                    <div class="panel warn">
                        <b style="color:var(--warn);">⚠️ PAQUETE YA REGISTRADO</b>
                        <div style="margin-top:10px;"><span class="code-badge">${pkg.codigo}</span></div>
                        <p style="margin:10px 0 2px;font-size:15px;font-weight:600;">${pkg.cliente_nombre}</p>
                        <p class="hint" style="margin:2px 0;">Estado: ${pkg.estado} · Ingreso: ${fmtDate(pkg.fecha_ingreso)}</p>
                        <p class="hint" style="margin:2px 0 10px;">Deuda: <b style="color:var(--accent)">${fmtMoney(deuda,cfg)}</b></p>
                        <div class="btn-row">
                            ${pkg.estado==='pendiente' ? '<button class="btn btn-success" onclick="App.confirmarEntrega('+pkg.id+')">✅ Entregar</button>' : ''}
                            <button class="btn btn-outline" onclick="App.openEditForm('+pkg.id+')">✏️ Editar</button>
                        </div>
                    </div>`;
        },

        showRegistrationForm(parsed) {
            const box = document.getElementById('scanResultBox');
            const fechaDisplay = parsed.fecha_ticket ?
                `<div class="field"><label>📅 Fecha del ticket</label><input id="frmFechaTicket" value="${parsed.fecha_ticket}" readonly style="background:var(--surface-2);"></div>` :
                '';

            box.innerHTML = `
                    <div class="panel success scan-result">
                        <h3>📦 Nuevo paquete detectado</h3>
                        <div style="margin-bottom:12px;"><span class="code-badge">${parsed.codigo}</span></div>
                        <div class="field"><label>👤 Nombre del cliente</label><input id="frmNombre" value="${(parsed.cliente_nombre||'').replace(/"/g,'')}"></div>
                        <div class="row2">
                            <div class="field"><label>📱 Celular</label><input id="frmCelular" value="${parsed.cliente_celular||''}"></div>
                            <div class="field"><label>📦 Detalle</label><input id="frmDetalle" value="${parsed.detalle||''}"></div>
                        </div>
                        ${fechaDisplay}
                        <div class="field"><label>👤 Quién dejó</label><input id="frmQuienDejo" placeholder="Opcional"></div>
                        <input type="hidden" id="frmCodigo" value="${parsed.codigo}">
                        <div class="btn-row">
                            <button class="btn btn-outline" onclick="App.limpiarResultado()">🗑️ Cancelar</button>
                            <button class="btn btn-primary" onclick="App.guardarPaqueteDesdeForm()">💾 Guardar paquete</button>
                        </div>
                    </div>`;
        },

        limpiarResultado() {
            document.getElementById('scanResultBox').innerHTML = '';
        },

        guardarPaqueteDesdeForm() {
            const codigo = document.getElementById('frmCodigo').value;
            const nombre = document.getElementById('frmNombre').value.trim();
            if (!nombre) { toast('El nombre es obligatorio'); return; }

            const result = DB.crearPaquete({
                codigo: codigo,
                cliente_nombre: nombre,
                cliente_celular: document.getElementById('frmCelular').value.trim() || null,
                detalle: document.getElementById('frmDetalle').value.trim() || null,
                quien_dejo: document.getElementById('frmQuienDejo').value.trim() || null,
                fecha_ticket: document.getElementById('frmFechaTicket')?.value.trim() || null
            });

            if (result.success) {
                toast('✅ Paquete registrado');
                document.getElementById('scanResultBox').innerHTML =
                    '<div class="panel success">✅ Paquete <b>' + codigo + '</b> registrado para <b>' + nombre + '</b>.</div>';
                this.renderPaquetes();
                this.updateHeaderStats();
            } else {
                toast('❌ ' + result.error);
                if (result.paquete) this.showExistingPackage(result.paquete);
            }
        },

        // ---------- Registro manual (CRUD) ----------
        openManualForm() {
            const html = `
                    <h3>📦 Registrar paquete manualmente</h3>
                    <div class="field"><label>Código</label><input id="mCodigo" placeholder="Ej: A6, A49"></div>
                    <div class="field"><label>Nombre del cliente</label><input id="mNombre"></div>
                    <div class="row2">
                        <div class="field"><label>Celular</label><input id="mCelular"></div>
                        <div class="field"><label>Detalle</label><input id="mDetalle"></div>
                    </div>
                    <div class="field"><label>Fecha del ticket</label><input id="mFechaTicket" placeholder="DD/MM/YYYY HH:MM"></div>
                    <div class="field"><label>Quién dejó</label><input id="mQuienDejo" placeholder="Opcional"></div>
                    <div class="btn-row">
                        <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
                        <button class="btn btn-primary" onclick="App.guardarManual()">💾 Guardar</button>
                    </div>`;
            this.openModal(html);
        },

        guardarManual() {
            const codigo = normalizeCodigo(document.getElementById('mCodigo').value);
            const nombre = document.getElementById('mNombre').value.trim();
            if (!esCodigoValido(codigo)) { toast('Código inválido. Ej: A6, A49'); return; }
            if (!nombre) { toast('El nombre es obligatorio'); return; }

            const result = DB.crearPaquete({
                codigo: codigo,
                cliente_nombre: nombre,
                cliente_celular: document.getElementById('mCelular').value.trim() || null,
                detalle: document.getElementById('mDetalle').value.trim() || null,
                quien_dejo: document.getElementById('mQuienDejo').value.trim() || null,
                fecha_ticket: document.getElementById('mFechaTicket').value.trim() || null
            });

            this.closeModal();
            if (result.success) {
                toast('✅ Paquete registrado');
                this.renderPaquetes();
                this.updateHeaderStats();
            } else {
                toast('❌ ' + result.error);
                if (result.paquete) this.showExistingPackage(result.paquete);
            }
        },

        // ---------- Lista de paquetes (READ) ----------
        setFilter(f) {
            this.filter = f;
            document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.f === f));
            this.renderPaquetes();
        },

        renderPaquetes() {
            const cfg = DB.getConfig();
            const q = (document.getElementById('searchBox')?.value || '').trim().toLowerCase();
            let paquetes = q ? DB.buscarPaquetes(q) : DB.obtenerPaquetes(this.filter);

            const total = DB.getPaquetes().length;
            const pend = DB.getPaquetes().filter(p => p.estado === 'pendiente').length;
            const deudaTotal = DB.getPaquetes().filter(p => p.estado === 'pendiente').reduce((s, p) => s + DB.calcularDeuda(p, cfg), 0);

            document.getElementById('statRow').innerHTML = `
                    <div class="stat"><b>${total}</b><span>Total</span></div>
                    <div class="stat"><b>${pend}</b><span>Pendientes</span></div>
                    <div class="stat"><b>${fmtMoney(deudaTotal,cfg)}</b><span>Deuda total</span></div>`;

            paquetes.sort((a, b) => b.fecha_ingreso.localeCompare(a.fecha_ingreso));

            const list = document.getElementById('pkgList');
            if (paquetes.length === 0) {
                list.innerHTML = '<div class="empty-state">📭 No hay paquetes que coincidan.</div>';
                return;
            }
            list.innerHTML = paquetes.map(p => this.pkgCardHtml(p, false)).join('');
        },

        pkgCardHtml(p, readOnly) {
            const cfg = DB.getConfig();
            const dias = daysBetween(p.fecha_ingreso);
            const deuda = p.estado === 'entregado' ? p.deuda_final : DB.calcularDeuda(p, cfg);
            let badgeClass = p.estado;
            let diasBadge = '';
            if (p.estado === 'pendiente') {
                if (dias > 10) diasBadge = '<span class="badge alerta">⏰ ' + dias + ' días</span>';
                else if (dias > 5) diasBadge = '<span class="badge" style="background:#fff3cd;color:#856404;">' + dias + ' días</span>';
                else diasBadge = '<span class="badge" style="background:var(--surface-2);color:var(--muted)">' + dias + ' días</span>';
            }
            const actions = readOnly ? '' : `
                    <div class="pkg-actions">
                        ${p.estado==='pendiente' ? '<button class="entregar" onclick="App.confirmarEntrega('+p.id+')">✅ Entregar</button>' : ''}
                        <button onclick="App.openEditForm('+p.id+')">✏️ Editar</button>
                        ${p.cliente_celular ? '<button class="wa" onclick="App.enviarWhatsapp('+p.id+')">💬 WhatsApp</button>' : ''}
                        <button onclick="App.verQr('+p.id+')">📱 QR</button>
                        <button class="eliminar" onclick="App.eliminarPaquete('+p.id+')">🗑️ Eliminar</button>
                    </div>`;
            return `
                    <div class="pkg-card">
                        <div class="pkg-top">
                            <div>
                                <span class="pkg-code">${p.codigo}</span>
                                <div class="pkg-name">${p.cliente_nombre}</div>
                            </div>
                            <span class="badge ${badgeClass}">${p.estado}</span>
                        </div>
                        <div class="pkg-meta">
                            ${p.detalle? '📦 '+p.detalle+' · ' : ''}📅 ${fmtDate(p.fecha_ingreso)} ${diasBadge}<br>
                            💰 <b style="color:var(--accent)">${fmtMoney(deuda,cfg)}</b>${p.cliente_celular? ' · 📱 '+p.cliente_celular : ''}${p.fecha_ticket ? ' · 🎫 '+p.fecha_ticket : ''}
                        </div>
                        ${actions}
                    </div>`;
        },

        // ---------- Consulta pública ----------
        renderPublicSearch() {
            const q = (document.getElementById('publicSearchBox')?.value || '').trim().toLowerCase();
            const box = document.getElementById('publicResultList');
            if (!q) {
                box.innerHTML = '<div class="empty-state">🔍 Escribe un código o nombre para buscar tu paquete.</div>';
                return;
            }
            const cfg = DB.getConfig();
            const paquetes = DB.buscarPaquetes(q);
            if (paquetes.length === 0) {
                box.innerHTML = '<div class="empty-state">📭 No se encontraron paquetes.</div>';
                return;
            }
            box.innerHTML = paquetes.map(p => {
                const deuda = p.estado === 'entregado' ? p.deuda_final : DB.calcularDeuda(p, cfg);
                return `<div class="pkg-card">
                        <div class="pkg-top">
                            <div><span class="pkg-code">${p.codigo}</span><div class="pkg-name">${p.cliente_nombre}</div></div>
                            <span class="badge ${p.estado}">${p.estado}</span>
                        </div>
                        <div class="pkg-meta">📅 Ingreso: ${fmtDate(p.fecha_ingreso)}${p.fecha_ticket ? ' · 🎫 '+p.fecha_ticket : ''}<br>💰 Deuda: <b style="color:var(--accent)">${fmtMoney(deuda,cfg)}</b></div>
                    </div>`;
            }).join('');
        },

        // ---------- Editar (UPDATE) ----------
        openEditForm(id) {
            const p = DB.obtenerPaquete(id);
            if (!p) return;
            const html = `
                    <h3>✏️ Editar paquete ${p.codigo}</h3>
                    <div class="field"><label>Código</label><input id="eCodigo" value="${p.codigo}"></div>
                    <div class="field"><label>Nombre</label><input id="eNombre" value="${p.cliente_nombre}"></div>
                    <div class="row2">
                        <div class="field"><label>Celular</label><input id="eCelular" value="${p.cliente_celular||''}"></div>
                        <div class="field"><label>Detalle</label><input id="eDetalle" value="${p.detalle||''}"></div>
                    </div>
                    <div class="field"><label>Fecha del ticket</label><input id="eFechaTicket" value="${p.fecha_ticket||''}"></div>
                    <div class="field"><label>Quién dejó</label><input id="eQuienDejo" value="${p.quien_dejo||''}"></div>
                    <div class="btn-row">
                        <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
                        <button class="btn btn-primary" onclick="App.guardarEdicion(${p.id})">💾 Guardar</button>
                    </div>`;
            this.openModal(html);
        },

        guardarEdicion(id) {
            const result = DB.actualizarPaquete(id, {
                codigo: document.getElementById('eCodigo').value.trim(),
                cliente_nombre: document.getElementById('eNombre').value.trim(),
                cliente_celular: document.getElementById('eCelular').value.trim(),
                detalle: document.getElementById('eDetalle').value.trim(),
                quien_dejo: document.getElementById('eQuienDejo').value.trim(),
                fecha_ticket: document.getElementById('eFechaTicket').value.trim()
            });

            this.closeModal();
            if (result.success) {
                toast('✅ Paquete actualizado');
                this.renderPaquetes();
                this.updateHeaderStats();
            } else {
                toast('❌ ' + result.error);
            }
        },

        // ---------- Entrega (UPDATE estado) ----------
        confirmarEntrega(id) {
            const p = DB.obtenerPaquete(id);
            if (!p || p.estado !== 'pendiente') return;
            const cfg = DB.getConfig();
            const deuda = DB.calcularDeuda(p, cfg);
            const html = `
                    <h3>✅ Confirmar entrega</h3>
                    <p class="hint">Código: <b style="color:var(--text)">${p.codigo}</b><br>Cliente: <b style="color:var(--text)">${p.cliente_nombre}</b><br>Deuda: <b style="color:var(--accent)">${fmtMoney(deuda,cfg)}</b></p>
                    <div class="field"><label>Monto pagado</label><input id="montoPagado" type="number" step="0.5" value="${deuda}"></div>
                    <div class="btn-row">
                        <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
                        <button class="btn btn-success" onclick="App.entregarPaquete(${p.id})">✅ Confirmar</button>
                    </div>`;
            this.openModal(html);
        },

        entregarPaquete(id) {
            const monto = parseFloat(document.getElementById('montoPagado').value) || 0;
            const result = DB.entregarPaquete(id, monto);
            this.closeModal();
            if (result.success) {
                toast('✅ Paquete entregado');
                this.renderPaquetes();
                this.updateHeaderStats();
                document.getElementById('scanResultBox').innerHTML = '<div class="panel success">✅ Paquete <b>' + result.paquete.codigo + '</b> entregado.</div>';
            } else {
                toast('❌ ' + result.error);
            }
        },

        // ---------- Eliminar (DELETE) ----------
        eliminarPaquete(id) {
            const p = DB.obtenerPaquete(id);
            if (!p) return;
            const html = `
                    <h3>🗑️ Eliminar paquete</h3>
                    <p class="hint">¿Eliminar <b style="color:var(--text)">${p.codigo} — ${p.cliente_nombre}</b>? Esta acción no se puede deshacer.</p>
                    <div class="btn-row">
                        <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
                        <button class="btn btn-danger" onclick="App.confirmarEliminar(${p.id})">🗑️ Eliminar</button>
                    </div>`;
            this.openModal(html);
        },

        confirmarEliminar(id) {
            const result = DB.eliminarPaquete(id);
            this.closeModal();
            if (result.success) {
                toast('Paquete eliminado');
                this.renderPaquetes();
                this.updateHeaderStats();
            } else {
                toast('❌ ' + result.error);
            }
        },

        eliminarTodosLosDatos() {
            const html = `
                    <h3>⚠️ ELIMINAR TODOS LOS DATOS</h3>
                    <p class="hint" style="color:var(--danger);font-weight:600;">Esta acción eliminará TODOS los paquetes, movimientos y configuraciones. No se puede deshacer.</p>
                    <p class="hint">¿Estás seguro de que quieres continuar?</p>
                    <div class="btn-row">
                        <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
                        <button class="btn btn-danger" onclick="App.confirmarEliminarTodo()">🗑️ Eliminar todo</button>
                    </div>`;
            this.openModal(html);
        },

        confirmarEliminarTodo() {
            const keys = ['ml_paquetes', 'ml_config', 'ml_movimientos', 'ml_seq'];
            for (const key of keys) {
                localStorage.removeItem(key);
            }
            this.closeModal();
            toast('🗑️ Todos los datos eliminados');
            this.renderPaquetes();
            this.updateHeaderStats();
            // Recargar configuración por defecto
            const cfg = DB.getConfig();
            document.getElementById('cfgMoneda').value = cfg.moneda;
            document.getElementById('cfgPrecioBase').value = cfg.precio_base;
            document.getElementById('cfgDiasGratis').value = cfg.dias_gratis;
            document.getElementById('cfgRecargo').value = cfg.recargo_diario;
            document.getElementById('scanResultBox').innerHTML = '';
        },

        // ---------- WhatsApp ----------
        enviarWhatsapp(id) {
            const p = DB.obtenerPaquete(id);
            if (!p || !p.cliente_celular) return;
            const cfg = DB.getConfig();
            const deuda = DB.calcularDeuda(p, cfg);
            const primerNombre = p.cliente_nombre.split(' ')[0];
            let numero = p.cliente_celular.replace(/\D/g, '');
            if (numero.length === 8) numero = '591' + numero;
            const mensaje = p.estado === 'pendiente' ?
                `Hola ${primerNombre} 👋\n\n📦 Tienes un paquete pendiente en MEDIA LUNA.\nCódigo: ${p.codigo}\n💰 Deuda: ${fmtMoney(deuda,cfg)}\n${p.fecha_ticket ? '🎫 Fecha ticket: '+p.fecha_ticket : ''}\n\n📍 Te esperamos.` :
                `Hola ${primerNombre} 👋\n\n✅ Tu paquete (${p.codigo}) ya fue entregado. ¡Gracias por confiar en MEDIA LUNA!`;
            window.open('https://wa.me/' + numero + '?text=' + encodeURIComponent(mensaje), '_blank');
        },

        // ---------- QR del paquete ----------
        verQr(id) {
            const p = DB.obtenerPaquete(id);
            if (!p) return;
            const html = `
                    <h3>📱 QR del paquete ${p.codigo}</h3>
                    <p class="hint">Token único para este paquete (incluso si el código ${p.codigo} se reutiliza).</p>
                    <div class="panel quiet" style="text-align:center;word-break:break-all;font-family:monospace;color:var(--accent);padding:12px;">${p.qr_token}</div>
                    <button class="btn btn-outline" onclick="App.closeModal()">Cerrar</button>`;
            this.openModal(html);
        },

        // ---------- Configuración ----------
        saveConfig() {
            const cfg = {
                moneda: document.getElementById('cfgMoneda').value.trim() || 'Bs',
                precio_base: parseFloat(document.getElementById('cfgPrecioBase').value) || 0,
                dias_gratis: parseInt(document.getElementById('cfgDiasGratis').value) || 0,
                recargo_diario: parseFloat(document.getElementById('cfgRecargo').value) || 0
            };
            DB.saveConfig(cfg);
            toast('✅ Configuración guardada');
            this.renderPaquetes();
        },

        updateHeaderStats() {
            const pend = DB.getPaquetes().filter(p => p.estado === 'pendiente').length;
            document.getElementById('headerStats').innerHTML = `<b>${pend}</b> pendientes`;
        },

        // ---------- Modal ----------
        openModal(innerHtml) {
            this.closeModal();
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop';
            backdrop.id = 'activeModal';
            backdrop.onclick = (e) => { if (e.target === backdrop) this.closeModal(); };
            const sheet = document.createElement('div');
            sheet.className = 'modal-sheet';
            sheet.innerHTML = innerHtml;
            backdrop.appendChild(sheet);
            document.body.appendChild(backdrop);
        },

        closeModal() {
            const m = document.getElementById('activeModal');
            if (m) m.remove();
        }
    };

    // Inicializar
    document.addEventListener('DOMContentLoaded', () => App.init());
})();