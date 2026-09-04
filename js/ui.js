/**
 * UI - Renderizado de interfaz, modales, toasts, tarjetas
 */

const UI = {
    // -------- Modal --------
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
    },

    // -------- Toast --------
    toast(msg, type) {
        const t = document.createElement('div');
        t.className = 'toast';
        if (type === 'error') t.style.borderColor = '#dc3545';
        if (type === 'success') t.style.borderColor = '#28a745';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2800);
    },

    // -------- Tarjeta de paquete --------
    renderPkgCard(p, readOnly, onAction) {
        const cfg = Config.getConfig();
        const dias = daysBetween(p.fecha_ingreso);
        const deuda = p.estado === 'entregado' ? p.deuda_final : Config.calcularDeuda(p, cfg);
        const estadoMora = Config.getEstadoMora(p, cfg);

        let diasBadge = '';
        if (p.estado === 'pendiente') {
            if (estadoMora === 'vencido') {
                diasBadge = '<span class="badge alerta">⏰ ' + dias + ' días 🔴</span>';
            } else if (estadoMora === 'alerta') {
                diasBadge = '<span class="badge" style="background:#fff3cd;color:#856404;">⏰ ' + dias + ' días ⚠️</span>';
            } else {
                diasBadge = '<span class="badge" style="background:var(--surface-2);color:var(--muted)">' + dias + ' días</span>';
            }
        }

        const badgeClass = p.estado === 'pendiente' ?
            (estadoMora === 'vencido' ? 'alerta' : 'pendiente') :
            'entregado';

        const badgeText = p.estado === 'pendiente' ?
            (estadoMora === 'vencido' ? '🔴 VENCIDO' : '⏳ Pendiente') :
            '✅ Entregado';

        const actions = readOnly ? '' : `
            <div class="pkg-actions">
                ${p.estado==='pendiente' ? '<button class="entregar" data-action="entregar" data-id="'+p.id+'">✅ Entregar</button>' : ''}
                <button data-action="editar" data-id="${p.id}">✏️ Editar</button>
                ${p.cliente_celular ? '<button class="wa" data-action="whatsapp" data-id="'+p.id+'">💬 WhatsApp</button>' : ''}
                <button data-action="qr" data-id="${p.id}">📱 QR</button>
                <button class="eliminar" data-action="eliminar" data-id="${p.id}">🗑️ Eliminar</button>
            </div>`;

        return `
            <div class="pkg-card" data-id="${p.id}">
                <div class="pkg-top">
                    <div>
                        <span class="pkg-code">${p.codigo}</span>
                        <div class="pkg-name">${p.cliente_nombre}</div>
                    </div>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="pkg-meta">
                    ${p.detalle? '📦 '+p.detalle+' · ' : ''}
                    📅 ${fmtDate(p.fecha_ingreso)} ${diasBadge}<br>
                    💰 <b style="color:var(--accent)">${fmtMoney(deuda,cfg)}</b>
                    ${p.cliente_celular? ' · 📱 '+p.cliente_celular : ''}
                    ${p.fecha_ticket ? ' · 🎫 '+p.fecha_ticket : ''}
                    ${p.quien_dejo ? ' · 👤 '+p.quien_dejo : ''}
                </div>
                ${actions}
            </div>`;
    },

    // -------- Mostrar resultado de escaneo --------
    showScanResult(parsed, modo) {
        const box = document.getElementById('scanResultBox');

        if (modo === 'consulta') {
            const paquetes = DB.buscarPaquetes(parsed.codigo);
            if (paquetes.length === 0) {
                box.innerHTML = '<div class="panel warn">No se encontró ningún paquete con código <b>' + parsed.codigo + '</b>.</div>';
                return;
            }
            box.innerHTML = '<div class="scan-result"><h3>📦 Resultados para ' + parsed.codigo + '</h3></div>';
            paquetes.sort((a, b) => b.fecha_ingreso.localeCompare(a.fecha_ingreso)).forEach(p => {
                box.innerHTML += this.renderPkgCard(p, true);
            });
            return;
        }

        // MODO REGISTRO
        const pendiente = DB.getPaquetes().find(p =>
            p.codigo === parsed.codigo && p.estado === 'pendiente'
        );

        if (pendiente) {
            box.innerHTML = `
                <div class="panel warn">
                    <b style="color:var(--warn);">⚠️ PAQUETE YA REGISTRADO</b>
                    <div style="margin-top:10px;"><span class="code-badge">${pendiente.codigo}</span></div>
                    <p style="margin:10px 0 2px;font-size:15px;font-weight:600;">${pendiente.cliente_nombre}</p>
                    <p class="hint" style="margin:2px 0;">Estado: ${pendiente.estado} · Ingreso: ${fmtDate(pendiente.fecha_ingreso)}</p>
                    <p class="hint" style="margin:2px 0 10px;">Deuda: <b style="color:var(--accent)">${fmtMoney(Config.calcularDeuda(pendiente), Config.getConfig())}</b></p>
                    <div class="btn-row">
                        ${pendiente.estado==='pendiente' ? '<button class="btn btn-success" onclick="App.confirmarEntrega('+pendiente.id+')">✅ Entregar</button>' : ''}
                        <button class="btn btn-outline" onclick="App.openEditForm('+pendiente.id+')">✏️ Editar</button>
                    </div>
                </div>`;
            return;
        }

        // Nuevo paquete
        const fechaDisplay = parsed.fecha_ticket ?
            `<div class="field"><label>📅 Fecha del ticket</label><input id="frmFechaTicket" value="${parsed.fecha_ticket}" readonly style="background:var(--surface-2);"></div>` :
            '';

        box.innerHTML = `
            <div class="panel success scan-result">
                <h3>📦 Nuevo paquete detectado</h3>
                <div style="margin-bottom:12px;"><span class="code-badge">${parsed.codigo}</span></div>
                <div class="field">
                    <label>👤 Nombre del cliente</label>
                    <input id="frmNombre" value="${(parsed.cliente_nombre||'').replace(/"/g,'')}">
                </div>
                <div class="row2">
                    <div class="field">
                        <label>📱 Celular</label>
                        <input id="frmCelular" value="${parsed.cliente_celular||''}">
                    </div>
                    <div class="field">
                        <label>📦 Detalle</label>
                        <input id="frmDetalle" value="${parsed.detalle||''}">
                    </div>
                </div>
                ${fechaDisplay}
                <div class="field">
                    <label>👤 Quién dejó</label>
                    <input id="frmQuienDejo" placeholder="Opcional">
                </div>
                <input type="hidden" id="frmCodigo" value="${parsed.codigo}">
                <div class="btn-row">
                    <button class="btn btn-outline" onclick="App.limpiarResultado()">🗑️ Cancelar</button>
                    <button class="btn btn-primary" onclick="App.guardarPaqueteDesdeForm()">💾 Guardar paquete</button>
                </div>
            </div>`;
    },

    // -------- Mostrar estadísticas --------
    renderStats(paquetes) {
        const cfg = Config.getConfig();
        const total = paquetes.length;
        const pend = paquetes.filter(p => p.estado === 'pendiente').length;
        const deudaTotal = paquetes.filter(p => p.estado === 'pendiente')
            .reduce((s, p) => s + Config.calcularDeuda(p, cfg), 0);
        const vencidos = paquetes.filter(p =>
            p.estado === 'pendiente' && Config.getEstadoMora(p, cfg) === 'vencido'
        ).length;

        document.getElementById('statRow').innerHTML = `
            <div class="stat"><b>${total}</b><span>Total</span></div>
            <div class="stat"><b>${pend}</b><span>Pendientes</span></div>
            <div class="stat"><b>${fmtMoney(deudaTotal,cfg)}</b><span>Deuda total</span></div>
            <div class="stat" style="border-left:3px solid var(--danger);"><b style="color:var(--danger);">${vencidos}</b><span>Vencidos</span></div>
        `;
    }
};