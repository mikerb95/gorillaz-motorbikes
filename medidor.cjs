// GENERADO desde instrumentacion/medidor.ts (CommonJS) por scripts/build-medidor.mjs.
// No editar a mano: cambia el .ts y corre `npm run medidor:build` en el portafolio.
/* eslint-disable */
"use strict";
// Medidor de cómputo para los proyectos de cliente desplegados en Vercel.
//
// Se COPIA tal cual al proyecto del cliente: un solo archivo, sin imports y sin
// dependencias, y TypeScript solo con sintaxis borrable (nada de enums ni
// namespaces) para que lo acepten Vite, el builder de Vercel y el
// `strip-types` de Node sin configuración. Plan y límites de precisión en
// `docs/plan-computo-clientes.md` del portafolio.
//
// Los proyectos en JavaScript puro (Express sobre Node 20, `require`) usan
// `medidor.mjs` o `medidor.cjs`, GENERADOS desde este archivo con
// `npm run medidor:build`. Se edita solo este; una prueba falla si los
// generados quedan desalineados.
//
// Mide lo que la función ve (CPU del proceso, tiempo con peticiones en curso,
// invocaciones, bytes de respuesta), lo acumula por hora en memoria y lo envía
// firmado con HMAC a `/api/computo/ingest`. Lo que el CDN sirve sin despertar
// la función (estáticos, aciertos de caché) queda fuera, y por eso la
// transferencia al visitante y las peticiones al edge son cotas inferiores.
//
// FAIL-OPEN en todo: un error del medidor nunca puede tumbar ni alterar la
// petición del cliente. El que es estricto es el endpoint que recibe.
Object.defineProperty(exports, "__esModule", { value: true });
exports.crearMedidor = crearMedidor;
exports.medidorDesdeEnv = medidorDesdeEnv;
const HORA_MS = 3_600_000;
/**
 * Cada envío es una invocación del portafolio, que sale de la MISMA cuota
 * gratis que se quiere vigilar. Diez minutos son, como mucho, ~4.300 envíos al
 * mes por instancia siempre ocupada; a un minuto serían diez veces más.
 */
const INTERVALO_POR_DEFECTO_MS = 10 * 60_000;
/** Tope de la cola de reintentos: 48 lotes son 8 h de ingesta caída. */
const MAX_PENDIENTES = 48;
/** Tope de muestras por lote, por debajo del que acepta la ingesta (240). */
const MAX_MUESTRAS_POR_LOTE = 200;
/**
 * Una petición abierta más que esto es un cuerpo que nadie leyó ni canceló.
 * Dejarla abierta mantendría la instancia "ocupada" y contaría memoria para
 * siempre, que es peor que perder la medición de una petición.
 */
const PETICION_HUERFANA_MS = 15 * 60_000;
const TIMEOUT_ENVIO_MS = 5_000;
/** Vercel da 500 ms tras el SIGTERM; se deja margen para salir a tiempo. */
const TIMEOUT_APAGADO_MS = 400;
/** En Hobby la memoria es fija: 2 GB. */
const MEMORIA_POR_DEFECTO_MB = 2048;
const ENDPOINT_POR_DEFECTO = 'https://codebymike.net/api/computo/ingest';
/** Estados sin cuerpo: construir un Response con cuerpo para ellos lanza. */
const SIN_CUERPO = new Set([101, 103, 204, 205, 304]);
const proceso = () => globalThis.process;
/** CPU acumulada del proceso, en ms. Mide el proceso y no la petición: con
 * concurrencia Fluid, dos peticiones solapadas no se cuentan dos veces. */
function cpuDelProceso() {
    const uso = proceso()?.cpuUsage?.();
    return uso ? (uso.user + uso.system) / 1000 : 0;
}
/** Mismo mecanismo que usa `waitUntil` de `@vercel/functions` por dentro. */
function waitUntilDelContexto() {
    const g = globalThis;
    return g[Symbol.for('@vercel/request-context')]?.get?.()?.waitUntil;
}
const positivo = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
function largoDeclarado(req) {
    try {
        return positivo(Number(req.headers.get('content-length')));
    }
    catch {
        return 0;
    }
}
function largoDe(fragmento, codificacion) {
    try {
        if (typeof fragmento === 'string') {
            const B = globalThis.Buffer;
            if (B)
                return B.byteLength(fragmento, typeof codificacion === 'string' ? codificacion : 'utf8');
            return new TextEncoder().encode(fragmento).byteLength;
        }
        if (fragmento instanceof Uint8Array)
            return fragmento.byteLength;
    }
    catch {
        // Codificación rara: se pierde el conteo de este fragmento, no la petición.
    }
    return 0;
}
function aHex(buf) {
    let s = '';
    for (const b of new Uint8Array(buf))
        s += b.toString(16).padStart(2, '0');
    return s;
}
const horaDe = (t) => Math.floor(t / HORA_MS) * HORA_MS;
const muestraVacia = (hora) => ({
    hora, cpuMs: 0, gbMs: 0, invocaciones: 0, transferBytes: 0, originTransferBytes: 0, edgeRequests: 0,
});
const tieneConsumo = (m) => m.cpuMs > 0 || m.gbMs > 0 || m.invocaciones > 0 || m.transferBytes > 0 || m.originTransferBytes > 0 || m.edgeRequests > 0;
// ---------------------------------------------------------------------------
// Núcleo
// ---------------------------------------------------------------------------
/**
 * Crea un medidor. Uno solo por proceso: dos medidores del mismo proceso
 * leerían la misma CPU y la contarían dos veces. `medidorDesdeEnv` ya lo
 * garantiza; esta función existe suelta para las pruebas.
 */
function crearMedidor(op) {
    const reloj = op.reloj ?? Date.now;
    const leerCpu = op.cpuMs ?? cpuDelProceso;
    const transporte = op.fetch ?? ((url, init) => globalThis.fetch(url, init));
    const nuevoId = op.nuevoId ?? (() => globalThis.crypto.randomUUID());
    const gb = (positivo(op.memoriaMb) || MEMORIA_POR_DEFECTO_MB) / 1024;
    const intervalo = positivo(op.intervaloMs) || INTERVALO_POR_DEFECTO_MS;
    const horas = new Map();
    /** Lotes sellados: cuerpo y batchId fijos, para que un reintento sea el mismo lote. */
    const pendientes = [];
    /** Peticiones en curso: id → inicio. */
    const abiertas = new Map();
    let siguienteId = 0;
    // Línea base en cero y no en la CPU actual: el primer delta incluye el
    // arranque en frío, que Vercel también cobra.
    let cpuPrevio = 0;
    let inicioOcupado = 0;
    let ultimaActividad = reloj();
    let ultimoEnvio = reloj();
    let enviando = null;
    let clave = null;
    let apagadoEnganchado = !op.engancharApagado;
    const cubo = (t) => {
        const h = horaDe(t);
        let m = horas.get(h);
        if (!m) {
            m = muestraVacia(h);
            horas.set(h, m);
        }
        return m;
    };
    function marcarCpu(ahora) {
        let actual;
        try {
            actual = leerCpu();
        }
        catch {
            return;
        }
        const delta = actual - cpuPrevio;
        if (!Number.isFinite(delta))
            return;
        cpuPrevio = actual;
        if (delta > 0)
            cubo(ahora).cpuMs += delta;
    }
    /** Suma memoria por el tiempo ocupado, partiendo el intervalo por horas. */
    function sumarOcupado(desde, hasta) {
        let t = desde;
        while (t < hasta) {
            const tramo = Math.min(hasta, horaDe(t) + HORA_MS) - t;
            cubo(t).gbMs += tramo * gb;
            t += tramo;
        }
    }
    function cerrarHuerfanas(ahora) {
        let cerradas = 0;
        for (const [id, inicio] of abiertas) {
            if (ahora - inicio > PETICION_HUERFANA_MS) {
                abiertas.delete(id);
                cerradas++;
            }
        }
        // Se asume que terminó con la última actividad observada, no ahora: una
        // huérfana suele ser un cuerpo que la plataforma dejó de leer hace rato.
        if (cerradas > 0 && abiertas.size === 0)
            sumarOcupado(inicioOcupado, Math.max(inicioOcupado, ultimaActividad));
    }
    function iniciar(bytesEntrada = 0) {
        try {
            if (!apagadoEnganchado) {
                apagadoEnganchado = true;
                proceso()?.once?.('SIGTERM', () => void vaciar({ timeoutMs: TIMEOUT_APAGADO_MS }));
            }
            const ahora = reloj();
            marcarCpu(ahora);
            cerrarHuerfanas(ahora);
            if (abiertas.size === 0)
                inicioOcupado = ahora;
            const id = siguienteId++;
            abiertas.set(id, ahora);
            ultimaActividad = ahora;
            const m = cubo(ahora);
            m.invocaciones++;
            // Toda invocación pasa por el edge; lo que el edge sirve solo, no se ve.
            m.edgeRequests++;
            const entrada = positivo(bytesEntrada);
            let cerrada = false;
            return (bytesSalida) => {
                if (cerrada)
                    return;
                cerrada = true;
                try {
                    cerrar(id, entrada, positivo(bytesSalida));
                }
                catch {
                    // fail-open
                }
            };
        }
        catch {
            return () => { };
        }
    }
    function cerrar(id, entrada, salida) {
        // Ya la cerró el barrido de huérfanas: su tiempo está contado.
        if (!abiertas.delete(id))
            return;
        const ahora = reloj();
        marcarCpu(ahora);
        ultimaActividad = ahora;
        const m = cubo(ahora);
        m.transferBytes += salida;
        m.originTransferBytes += salida + entrada;
        if (abiertas.size === 0)
            sumarOcupado(inicioOcupado, ahora);
        if (ahora - ultimoEnvio >= intervalo)
            programarEnvio();
    }
    function sellar(ahora) {
        marcarCpu(ahora);
        cerrarHuerfanas(ahora);
        // Con peticiones en curso, lo ocupado hasta ahora se cuenta ya y el tramo
        // sigue abierto desde este instante.
        if (abiertas.size > 0) {
            sumarOcupado(inicioOcupado, ahora);
            inicioOcupado = ahora;
        }
        const muestras = [...horas.values()].filter(tieneConsumo).sort((a, b) => a.hora - b.hora);
        horas.clear();
        for (let i = 0; i < muestras.length; i += MAX_MUESTRAS_POR_LOTE) {
            const batchId = nuevoId();
            pendientes.push({ batchId, cuerpo: JSON.stringify({ batchId, muestras: muestras.slice(i, i + MAX_MUESTRAS_POR_LOTE) }) });
        }
        while (pendientes.length > MAX_PENDIENTES) {
            pendientes.shift();
            console.error('[medidor] cola llena: se descartó el lote más viejo');
        }
    }
    async function firmar(mensaje) {
        const cod = new TextEncoder();
        // La llave son los bytes UTF-8 del secreto tal cual (hex como texto), que
        // es lo que hace `createHmac('sha256', secreto)` del lado que verifica.
        clave ??= globalThis.crypto.subtle.importKey('raw', cod.encode(op.secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        try {
            return aHex(await globalThis.crypto.subtle.sign('HMAC', await clave, cod.encode(mensaje)));
        }
        catch (e) {
            clave = null;
            throw e;
        }
    }
    async function enviarLote(lote, timeoutMs) {
        let res;
        try {
            const ts = reloj();
            const firma = await firmar(`${ts}.${lote.cuerpo}`);
            res = await transporte(op.endpoint, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-computo-project': op.proyecto,
                    'x-computo-timestamp': String(ts),
                    'x-computo-signature': firma,
                },
                body: lote.cuerpo,
                signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
            });
        }
        catch {
            return 'reintentar';
        }
        // Liberar la conexión: el cuerpo de la respuesta no interesa.
        res.body?.cancel().catch(() => { });
        if (res.ok)
            return 'entregado';
        if (res.status === 408 || res.status === 429 || res.status >= 500)
            return 'reintentar';
        // Un 4xx no se arregla reintentando: firma, formato o proyecto mal
        // configurados. Reintentarlo solo llenaría la cola.
        console.error(`[medidor] la ingesta rechazó un lote (HTTP ${res.status}); se descarta`);
        return 'descartado';
    }
    async function enviarCola(timeoutMs) {
        try {
            const ahora = reloj();
            ultimoEnvio = ahora;
            sellar(ahora);
            while (pendientes.length > 0) {
                const resultado = await enviarLote(pendientes[0], timeoutMs);
                // En orden y sin saltarse ninguno: si la ingesta está caída, el
                // siguiente lote tampoco va a entrar.
                if (resultado === 'reintentar')
                    break;
                pendientes.shift();
            }
        }
        catch (e) {
            console.error('[medidor] envío fallido', e);
        }
    }
    function vaciar(opciones) {
        if (enviando)
            return enviando;
        const tarea = enviarCola(positivo(opciones?.timeoutMs) || TIMEOUT_ENVIO_MS);
        enviando = tarea;
        // Se libera al terminar y no en un `finally` dentro de la tarea: si la
        // cola está vacía la tarea termina antes de la asignación y el candado
        // quedaría puesto para siempre.
        void tarea.then(() => {
            if (enviando === tarea)
                enviando = null;
        });
        return tarea;
    }
    function programarEnvio() {
        const tarea = vaciar();
        try {
            // Sin waitUntil, Fluid puede pausar la instancia a mitad del envío. No
            // se pierde nada (el lote queda en cola), solo llega más tarde.
            ;
            (op.waitUntil ?? waitUntilDelContexto())?.(tarea);
        }
        catch {
            // fail-open
        }
    }
    function envolverRespuesta(respuesta, cerrarPeticion) {
        try {
            const original = respuesta.body;
            if (!original || SIN_CUERPO.has(respuesta.status)) {
                cerrarPeticion(0);
                return respuesta;
            }
            let lector = null;
            let bytes = 0;
            const fin = () => cerrarPeticion(bytes);
            // El lector se toma en el primer `pull` y no aquí: si el constructor de
            // Response lanzara, el cuerpo original seguiría sin bloquear y se podría
            // devolver la respuesta intacta.
            const contado = new ReadableStream({
                async pull(ctrl) {
                    try {
                        lector ??= original.getReader();
                        const { done, value } = await lector.read();
                        if (done) {
                            fin();
                            ctrl.close();
                            return;
                        }
                        bytes += value?.byteLength ?? 0;
                        ctrl.enqueue(value);
                    }
                    catch (e) {
                        fin();
                        ctrl.error(e);
                    }
                },
                cancel(motivo) {
                    fin();
                    return (lector ?? original.getReader()).cancel(motivo);
                },
            });
            return new Response(contado, { status: respuesta.status, statusText: respuesta.statusText, headers: respuesta.headers });
        }
        catch {
            cerrarPeticion(0);
            return respuesta;
        }
    }
    function envolverHandlerWeb(req, handler) {
        const cerrarPeticion = iniciar(largoDeclarado(req));
        return (async () => {
            let res;
            try {
                res = await handler();
            }
            catch (e) {
                cerrarPeticion(0);
                throw e;
            }
            // Un HEAD no tiene cuerpo que leer: esperar a que alguien lo consuma
            // dejaría la petición abierta hasta el barrido de huérfanas.
            if (req.method === 'HEAD') {
                cerrarPeticion(0);
                return res;
            }
            return envolverRespuesta(res, cerrarPeticion);
        })();
    }
    return {
        activo: true,
        iniciar,
        envolverRespuesta,
        fetch(handler) {
            return (req, ...resto) => envolverHandlerWeb(req, () => handler(req, ...resto));
        },
        astro() {
            // Astro corre el middleware también al prerenderizar, en el proceso del
            // build: esos renders no son visitas ni gastan cuota, y contarlos
            // inflaría las invocaciones de cada despliegue.
            return (contexto, next) => (contexto.isPrerendered ? next() : envolverHandlerWeb(contexto.request, next));
        },
        express() {
            return (req, res, next) => {
                try {
                    const cerrarPeticion = iniciar(positivo(Number(req.headers['content-length'])));
                    let bytes = 0;
                    let dentroDeEnd = false;
                    const escribir = res.write;
                    const terminar = res.end;
                    res.write = function (...args) {
                        // Algunas implementaciones de end() pasan por write(): sin esta
                        // guarda el último fragmento se contaría dos veces.
                        if (!dentroDeEnd)
                            bytes += largoDe(args[0], args[1]);
                        return escribir.apply(this, args);
                    };
                    res.end = function (...args) {
                        if (typeof args[0] !== 'function')
                            bytes += largoDe(args[0], args[1]);
                        dentroDeEnd = true;
                        try {
                            return terminar.apply(this, args);
                        }
                        finally {
                            dentroDeEnd = false;
                        }
                    };
                    // `close` cubre al cliente que se desconecta antes de `finish`.
                    const fin = () => cerrarPeticion(bytes);
                    res.once('finish', fin);
                    res.once('close', fin);
                }
                catch {
                    // fail-open
                }
                next();
            };
        },
        vaciar,
        estado() {
            return {
                enVuelo: abiertas.size,
                horas: [...horas.values()].map((m) => ({ ...m })),
                pendientes: pendientes.length,
            };
        },
    };
}
// ---------------------------------------------------------------------------
// Medidor inerte y configuración por entorno
// ---------------------------------------------------------------------------
const INERTE = {
    activo: false,
    iniciar: () => () => { },
    envolverRespuesta: (respuesta) => respuesta,
    fetch: (handler) => async (req, ...resto) => handler(req, ...resto),
    astro: () => (_contexto, next) => next(),
    express: () => (_req, _res, next) => next(),
    vaciar: async () => { },
    estado: () => ({ enVuelo: 0, horas: [], pendientes: 0 }),
};
const REGISTRO = Symbol.for('codebymike.medidor');
/** Registro por proceso en `globalThis`: sobrevive a que el bundler duplique este módulo. */
function registro() {
    const g = globalThis;
    let r = g[REGISTRO];
    if (!r) {
        r = new Map();
        g[REGISTRO] = r;
    }
    return r;
}
/**
 * Medidor configurado por variables de entorno, único por proceso.
 *
 * Sin `COMPUTO_PROYECTO` o `COMPUTO_SECRETO`, o fuera de Vercel, devuelve un
 * medidor inerte en silencio: el desarrollo local no debe sumar consumo al
 * proyecto real. `COMPUTO_FORZAR=1` lo activa fuera de Vercel para probarlo.
 */
function medidorDesdeEnv(opciones = {}) {
    try {
        const env = opciones.env ?? proceso()?.env ?? {};
        const proyecto = env.COMPUTO_PROYECTO?.trim();
        const secreto = env.COMPUTO_SECRETO?.trim();
        const enVercel = env.VERCEL === '1' && env.VERCEL_ENV !== 'development';
        if (!proyecto || !secreto || !(enVercel || env.COMPUTO_FORZAR === '1'))
            return INERTE;
        const endpoint = env.COMPUTO_ENDPOINT?.trim() || ENDPOINT_POR_DEFECTO;
        const clave = `${endpoint}|${proyecto}`;
        const existentes = registro();
        const previo = existentes.get(clave);
        if (previo)
            return previo;
        const medidor = crearMedidor({
            endpoint,
            proyecto,
            secreto,
            memoriaMb: positivo(Number(env.COMPUTO_MEMORIA_MB)) || undefined,
            waitUntil: opciones.waitUntil,
            // Solo en Vercel: fuera de ahí, un listener de SIGTERM cambiaría cómo se
            // apaga la app (Node deja de salir solo al recibir la señal).
            engancharApagado: enVercel,
        });
        existentes.set(clave, medidor);
        return medidor;
    }
    catch {
        return INERTE;
    }
}
