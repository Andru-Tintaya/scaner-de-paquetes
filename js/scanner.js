/**
 * SCANNER - Gestión de cámara, OCR y QR (OPTIMIZADO)
 */

const Scanner = {
    stream: null,
    currentDeviceId: null,
    availableCameras: [],
    ocrWorker: null,
    scanMode: 'registro',
    scanType: 'ocr',
    onResultCallback: null,
    isProcessing: false,

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

    // -------- Cámara --------
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
        document.getElementById('btnCapture').style.display = 'inline-flex';

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.availableCameras = devices.filter(d => d.kind === 'videoinput');
            document.getElementById('btnSwitchCam').style.display = this.availableCameras.length > 1 ? 'inline-flex' : 'none';
        } catch (e) {}

        this.setStatus('✅ Cámara lista. Presiona "Capturar y Escanear"', true);
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
        document.getElementById('btnCapture').style.display = 'none';
        this.setStatus('', false);
        if (!keepResult) document.getElementById('scanResultBox').innerHTML = '';
    },

    setStatus(msg, show) {
        const el = document.getElementById('camStatus');
        el.textContent = msg;
        el.classList.toggle('show', !!show);
    },

    // ============================================================
    // 🚀 CAPTURAR Y ESCANEAR (RÁPIDO)
    // ============================================================
    async capturarYEscanear() {
        if (this.isProcessing) return;
        if (!this.stream) {
            toast('Primero inicia la cámara', 'error');
            return;
        }

        this.isProcessing = true;
        this.setStatus('📸 Capturando imagen...', true);

        try {
            const video = document.getElementById('video');

            // 1. Capturar frame en un canvas
            const canvas = document.getElementById('ocrCanvas');
            const vW = video.videoWidth;
            const vH = video.videoHeight;

            // Escala para mejor rendimiento (no muy grande)
            const scale = Math.min(1.2, 800 / vW);
            const w = Math.round(vW * scale);
            const h = Math.round(vH * scale);
            canvas.width = w;
            canvas.height = h;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, w, h);

            // 2. MEJORA RÁPIDA DE IMAGEN (contraste + nitidez)
            this.mejorarImagenRapida(ctx, w, h);

            this.setStatus('🔎 Escaneando ticket...', true);

            // 3. OCR - UN SOLO PASO (sin múltiples escalas)
            const worker = await this.getOcrWorker();
            const { data } = await worker.recognize(
                canvas.toDataURL('image/jpeg', 0.92),
                'spa+eng',
                { tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK }
            );

            const texto = data.text;
            console.log('📝 OCR:', texto);

            // 4. Parsear resultado
            const parsed = Parser.parseTicketData(texto);

            if (parsed.codigo && parsed.codigo.length >= 2) {
                this.setStatus('✅ Ticket leído', true);
                if (this.onResultCallback) {
                    this.onResultCallback(parsed);
                }
            } else {
                this.setStatus('⚠️ No se detectó código. Intenta de nuevo o escribe manualmente.', true);
                // Mostrar formulario con campos vacíos para corrección manual
                if (this.onResultCallback) {
                    this.onResultCallback({
                        codigo: '',
                        cliente_nombre: '',
                        cliente_celular: '',
                        detalle: '',
                        fecha_ticket: '',
                        tienda: 'MEDIA LUNA',
                        _manual: true
                    });
                }
            }

        } catch (e) {
            console.error('Error en captura:', e);
            this.setStatus('⚠️ Error al escanear. Intenta de nuevo.', true);
            toast('Error al procesar la imagen', 'error');
        } finally {
            this.isProcessing = false;
        }
    },

    // ============================================================
    // MEJORA DE IMAGEN RÁPIDA (contraste + nitidez)
    // ============================================================
    mejorarImagenRapida(ctx, w, h) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;

        // 1. Convertir a escala de grises
        for (let i = 0; i < d.length; i += 4) {
            const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            d[i] = d[i + 1] = d[i + 2] = gray;
        }

        // 2. Contraste fuerte (resalta texto)
        const factorContraste = 1.6;
        const umbral = 128;
        for (let i = 0; i < d.length; i += 4) {
            let val = d[i];
            val = (val - umbral) * factorContraste + umbral;
            val = Math.max(0, Math.min(255, val));
            d[i] = d[i + 1] = d[i + 2] = val > 135 ? 255 : 0; // Binarización
        }

        // 3. Filtro de nitidez simple (opcional)
        // omitimos para velocidad

        ctx.putImageData(imgData, 0, 0);
    },

    // ============================================================
    // SUBIR FOTO (con mejora rápida)
    // ============================================================
    async handleFileUpload(file) {
        if (!file) return;
        if (this.scanType !== 'ocr') { toast('Cambia a modo OCR', 'error'); return; }
        this.setStatus('🔎 Procesando imagen...', true);

        try {
            const img = await createImageBitmap(file);
            const canvas = document.getElementById('ocrCanvas');
            const scale = Math.min(1.2, 800 / img.width);
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            this.mejorarImagenRapida(ctx, canvas.width, canvas.height);

            const worker = await this.getOcrWorker();
            const { data } = await worker.recognize(
                canvas.toDataURL('image/jpeg', 0.92),
                'spa+eng',
                { tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK }
            );

            const parsed = Parser.parseTicketData(data.text);
            this.setStatus('', false);

            if (parsed.codigo && parsed.cliente_nombre) {
                if (this.onResultCallback) this.onResultCallback(parsed);
            } else {
                toast('No se detectó código y nombre.', 'error');
                if (this.onResultCallback) {
                    this.onResultCallback({
                        codigo: '',
                        cliente_nombre: '',
                        cliente_celular: '',
                        detalle: '',
                        fecha_ticket: '',
                        tienda: 'MEDIA LUNA',
                        _manual: true
                    });
                }
            }
        } catch (e) {
            toast('Error: ' + e.message, 'error');
        }
        document.getElementById('fileInput').value = '';
    },

    // ============================================================
    // QR SCANNER
    // ============================================================
    async startQr() {
        document.getElementById('video').style.display = 'none';
        document.getElementById('qr-reader').style.display = 'block';
        document.getElementById('camPlaceholder').style.display = 'none';
        document.getElementById('btnStartCam').style.display = 'none';
        document.getElementById('btnStopCam').style.display = 'inline-flex';
        document.getElementById('btnCapture').style.display = 'none';
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
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.setStatus('✅ QR leído', true);
        if (this.qrScanner) { this.qrScanner.pause(true); }
        setTimeout(() => { this.isProcessing = false; }, 1000);

        if (text.includes('|')) {
            const parsed = Parser.parseQRData(text);
            if (parsed && parsed.codigo && parsed.cliente_nombre) {
                if (this.onResultCallback) this.onResultCallback(parsed);
                return;
            }
        }

        const paquetes = DB.getPaquetes();
        const pkg = paquetes.find(p => p.qr_token === text);
        if (pkg) {
            if (this.onResultCallback) this.onResultCallback({ _existing: true, paquete: pkg });
        } else {
            toast('QR no reconocido.', 'error');
            if (this.qrScanner) this.qrScanner.resume();
        }
    },

    async getOcrWorker() {
        if (!this.ocrWorker) {
            this.setStatus('⏳ Cargando OCR...', true);
            this.ocrWorker = await Tesseract.createWorker('spa');
        }
        return this.ocrWorker;
    }
};