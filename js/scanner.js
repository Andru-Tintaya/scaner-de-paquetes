/**
 * SCANNER - Gestión de cámara, OCR y QR
 */

const Scanner = {
    stream: null,
    currentDeviceId: null,
    availableCameras: [],
    ocrWorker: null,
    ocrTimer: null,
    ocrBusy: false,
    qrScanner: null,
    scanMode: 'registro',
    scanType: 'ocr',
    onResultCallback: null,

    // Inicializar
    init(onResult) {
        this.onResultCallback = onResult || function() {};
    },

    // -------- Modos --------
    setMode(mode) {
        this.scanMode = mode;
        document.getElementById('modeRegistro').classList.toggle('active', mode === 'registro');
        document.getElementById('modeConsulta').classList.toggle('active', mode === 'consulta');
    },

    setType(type) {
        if (this.stream || this.qrScanner) this.stop();
        this.scanType = type;
        document.getElementById('typeOcr').classList.toggle('active', type === 'ocr');
        document.getElementById('typeQr').classList.toggle('active', type === 'qr');
        document.getElementById('scanResultBox').innerHTML = '';
    },

    // -------- Cámara OCR --------
    async startCamera() {
        document.getElementById('scanResultBox').innerHTML = '';
        if (this.scanType === 'qr') { return this.startQr(); }

        try {
            const constraints = this.currentDeviceId ?
                { video: { deviceId: { exact: this.currentDeviceId } } } :
                { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            toast('❌ No se pudo acceder a la cámara: ' + e.message, 'error');
            return;
        }

        const video = document.getElementById('video');
        video.srcObject = this.stream;
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

        this.setStatus('🔎 Escaneando ticket...', true);
        this.startOcrLoop();
    },

    async switchCamera() {
        if (!this.availableCameras.length) return;
        const idx = this.availableCameras.findIndex(d => d.deviceId === this.currentDeviceId);
        const next = this.availableCameras[(idx + 1) % this.availableCameras.length];
        this.currentDeviceId = next.deviceId;
        this.stop(true);
        await this.startCamera();
    },

    stop(keepResult) {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
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
        this.setStatus('', false);
        if (!keepResult) document.getElementById('scanResultBox').innerHTML = '';
    },

    setStatus(msg, show) {
        const el = document.getElementById('camStatus');
        el.textContent = msg;
        el.classList.toggle('show', !!show);
    },

    async getOcrWorker() {
        if (!this.ocrWorker) {
            this.setStatus('⏳ Cargando motor OCR...', true);
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
        if (this.ocrBusy || !this.stream) return;
        const video = document.getElementById('video');
        if (video.videoWidth === 0) return;
        this.ocrBusy = true;
        this.setStatus('🔎 Leyendo ticket...', true);

        try {
            const canvas = this.preprocessFrame(video);

            // Múltiples escalas para detectar código gigante
            const escalas = [1.0, 0.7, 0.5, 0.35];
            let mejorCodigo = null;
            let mejorNombre = null;
            let mejorTexto = '';
            let mejorFecha = null;

            for (const escala of escalas) {
                if (this.ocrBusy === false) break;

                const canvasTemp = document.createElement('canvas');
                const w = Math.round(canvas.width * escala);
                const h = Math.round(canvas.height * escala);
                canvasTemp.width = w;
                canvasTemp.height = h;
                const ctxTemp = canvasTemp.getContext('2d');
                ctxTemp.imageSmoothingEnabled = true;
                ctxTemp.imageSmoothingQuality = 'high';
                ctxTemp.drawImage(canvas, 0, 0, w, h);

                // Binarización
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
                const parsed = Parser.parseTicketData(texto);

                if (parsed.codigo && parsed.cliente_nombre) {
                    mejorCodigo = parsed.codigo;
                    mejorNombre = parsed.cliente_nombre;
                    mejorTexto = texto;
                    if (parsed.fecha_ticket) mejorFecha = parsed.fecha_ticket;
                    break;
                } else if (parsed.codigo && !mejorCodigo) {
                    mejorCodigo = parsed.codigo;
                    mejorTexto = texto;
                }
            }

            // Fallback con worker
            if (!mejorCodigo) {
                const worker = await this.getOcrWorker();
                const { data } = await worker.recognize(canvas);
                const parsed = Parser.parseTicketData(data.text);
                if (parsed.codigo && parsed.cliente_nombre) {
                    mejorCodigo = parsed.codigo;
                    mejorNombre = parsed.cliente_nombre;
                    mejorTexto = data.text;
                }
            }

            if (mejorCodigo && mejorCodigo.length >= 2) {
                if (!mejorNombre) {
                    const parsed = Parser.parseTicketData(mejorTexto);
                    mejorNombre = parsed.cliente_nombre;
                }

                clearInterval(this.ocrTimer);
                this.ocrTimer = null;
                this.setStatus('✅ Ticket leído', true);

                const parsedFinal = Parser.parseTicketData(mejorTexto);
                const resultado = {
                    codigo: mejorCodigo,
                    cliente_nombre: mejorNombre || parsedFinal.cliente_nombre,
                    cliente_celular: parsedFinal.cliente_celular,
                    detalle: parsedFinal.detalle,
                    fecha_ticket: parsedFinal.fecha_ticket || mejorFecha,
                    tienda: parsedFinal.tienda || 'MEDIA LUNA'
                };

                if (this.onResultCallback) {
                    this.onResultCallback(resultado);
                }
            } else {
                this.setStatus('🔎 Escaneando...', true);
            }

        } catch (e) {
            console.error('OCR Error:', e);
            this.setStatus('⚠️ Error, acerca la cámara', true);
        } finally {
            this.ocrBusy = false;
        }
    },

    // -------- Subir foto --------
    async handleFileUpload(file) {
        if (!file) return;
        if (this.scanType !== 'ocr') { toast('Cambia a modo OCR', 'error'); return; }
        this.setStatus('🔎 Leyendo imagen...', true);
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
                const parsed = Parser.parseTicketData(result.data.text);
                if (parsed.codigo && parsed.cliente_nombre) {
                    mejorParsed = parsed;
                    break;
                } else if (parsed.codigo && !mejorParsed) {
                    mejorParsed = parsed;
                }
            }

            this.setStatus('', false);
            if (mejorParsed && mejorParsed.codigo && mejorParsed.cliente_nombre) {
                if (this.onResultCallback) {
                    this.onResultCallback(mejorParsed);
                }
            } else {
                toast('No se detectó código y nombre. Intenta con una foto más clara.', 'error');
            }
        } catch (e) {
            toast('Error: ' + e.message, 'error');
        }
    },

    // -------- QR --------
    async startQr() {
        document.getElementById('video').style.display = 'none';
        document.getElementById('qr-reader').style.display = 'block';
        document.getElementById('camPlaceholder').style.display = 'none';
        document.getElementById('btnStartCam').style.display = 'none';
        document.getElementById('btnStopCam').style.display = 'inline-flex';
        this.setStatus('🔎 Apunta al QR...', true);

        this.qrScanner = new Html5Qrcode('qr-reader');
        try {
            await this.qrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 230 },
                (decodedText) => { this.onQrSuccess(decodedText); },
                () => {}
            );
        } catch (e) {
            toast('Error al iniciar QR: ' + e.message, 'error');
            this.stop();
        }
    },

    onQrSuccess(text) {
        if (this.ocrBusy) return;
        this.ocrBusy = true;
        this.setStatus('✅ QR leído', true);
        if (this.qrScanner) { this.qrScanner.pause(true); }
        setTimeout(() => { this.ocrBusy = false; }, 1500);

        if (text.includes('|')) {
            const parsed = Parser.parseQRData(text);
            if (parsed && parsed.codigo && parsed.cliente_nombre) {
                if (this.onResultCallback) {
                    this.onResultCallback(parsed);
                }
                return;
            }
        }

        // QR es un token de paquete existente
        const paquetes = DB.getPaquetes();
        const pkg = paquetes.find(p => p.qr_token === text);
        if (pkg) {
            if (this.onResultCallback) {
                this.onResultCallback({ _existing: true, paquete: pkg });
            }
        } else {
            toast('QR no reconocido.', 'error');
            if (this.qrScanner) this.qrScanner.resume();
        }
    }
};