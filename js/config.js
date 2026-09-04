/**
 * CONFIGURACIÓN - Gestión de configuración y cálculo de deuda
 */

const Config = {
    DEFAULTS: {
        moneda: 'Bs',
        precio_base: 3.00,
        dias_gratis: 5,
        recargo_diario: 0.50,
        dias_mora: 15
    },

    getConfig() {
        return DB.read('ml_config', this.DEFAULTS);
    },

    saveConfig(cfg) {
        const full = { ...this.DEFAULTS, ...cfg };
        DB.write('ml_config', full);
        return full;
    },

    calcularDeuda(paquete, cfg) {
        cfg = cfg || this.getConfig();
        if (paquete.estado === 'entregado' && paquete.deuda_final !== null) {
            return paquete.deuda_final;
        }

        const dias = Math.max(0, daysBetween(paquete.fecha_ingreso));
        let deuda = Number(cfg.precio_base);

        if (dias > Number(cfg.dias_gratis)) {
            const extra = dias - Number(cfg.dias_gratis);
            deuda += extra * Number(cfg.recargo_diario);
        }

        return Math.round(deuda * 100) / 100;
    },

    getEstadoMora(paquete, cfg) {
        cfg = cfg || this.getConfig();
        const dias = Math.max(0, daysBetween(paquete.fecha_ingreso));
        const gratis = Number(cfg.dias_gratis);
        const moraMax = Number(cfg.dias_mora || 15);

        if (paquete.estado === 'entregado') return 'entregado';
        if (dias <= gratis) return 'normal';
        if (dias <= moraMax) return 'alerta';
        return 'vencido';
    },

    getColorEstado(estado) {
        const map = {
            'normal': '#28a745',
            'alerta': '#ffc107',
            'vencido': '#dc3545',
            'entregado': '#6c757d'
        };
        return map[estado] || '#6c757d';
    },

    getBadgeEstado(estado) {
        const map = {
            'normal': '<span class="badge" style="background:#d4edda;color:#155724;">✅ Normal</span>',
            'alerta': '<span class="badge" style="background:#fff3cd;color:#856404;">⚠️ Alerta</span>',
            'vencido': '<span class="badge alerta">🔴 Vencido</span>',
            'entregado': '<span class="badge entregado">✅ Entregado</span>'
        };
        return map[estado] || '';
    },

    getResumenDeuda() {
        const cfg = this.getConfig();
        const paquetes = DB.getPaquetes();
        const pendientes = paquetes.filter(p => p.estado === 'pendiente');

        let totalDeuda = 0;
        let totalVencidos = 0;
        let totalAlerta = 0;
        let totalNormal = 0;

        for (const p of pendientes) {
            const deuda = this.calcularDeuda(p, cfg);
            totalDeuda += deuda;
            const estado = this.getEstadoMora(p, cfg);
            if (estado === 'vencido') totalVencidos++;
            else if (estado === 'alerta') totalAlerta++;
            else totalNormal++;
        }

        return {
            totalPendientes: pendientes.length,
            totalDeuda: totalDeuda,
            totalVencidos,
            totalAlerta,
            totalNormal,
            cfg
        };
    }
};