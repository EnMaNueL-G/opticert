# 🛡️ OptiCert

**Diagnóstico, grading y certificado de confianza para móviles usados — gratis y de código abierto.**

OptiCert conecta un móvil por ADB y, en segundos, lo **diagnostica**, le asigna un **grado A/B/C/D** y emite un **certificado PDF firmado** (Ed25519 + QR de verificación). Pensado para el mercado de móviles de segunda mano: tiendas, *refurbishers* y compraventa entre particulares con garantía.

Parte de la suite [OptiSuite](https://optisuite.app). Sin anuncios, sin telemetría: tus datos no salen del equipo.

---

## ✨ Qué hace

- **Diagnóstico por ADB**: modelo, IMEI, almacenamiento, RAM, pantalla y **batería** (salud real con ASOC si hay root, ciclos, temperatura, voltaje).
- **IMEI**: validez **Luhn + TAC** (offline) y **blacklist/robo en tiempo real** vía API (BYOK; IMEI.info, imeicheck, etc.).
- **Grading A/B/C/D** objetivo (con grado provisional sin root) y semáforo **"listo para vender"** (bloquea si FRP/iCloud o IMEI inválido).
- **Certificado PDF firmado** (Ed25519) con QR de verificación y tu marca.
- **Pruebas funcionales**: auto-verificación por software (cámaras, flash, sensores vivos, carga, WiFi/BT), **cámara en vivo** dentro de la herramienta, **botones que se marcan al pulsarlos** (getevent), **gráfico WiFi/BT en tiempo real** y **test de estrés térmico**.
- **Borrado RGPD** con vídeo de prueba, **export a marketplaces** (título/descr./precio/CSV), **historial** y **consola ADB**.

---

## 🚀 Uso (desarrollo)

```bash
npm install
npm start
```

Verificación sin abrir ventana:

```bash
npm run selftest
```

Requiere **ADB** instalado y un móvil con depuración USB activada (o WiFi-ADB).

---

## ⚖️ Uso responsable

OptiCert lee **solo datos del propio dispositivo** y no recopila información personal del usuario del móvil. El certificado lo emite el operario bajo su responsabilidad, a partir de pruebas de software; no constituye garantía salvo la que ofrezca el vendedor.

## 🤝 Colaborar

Si te resulta útil, puedes apoyar el proyecto (opcional): **Binance Pay ID** `1140153333` · **BSC (BEP20)** `0x0a9a0d8d816ede885d1d4a5c94369a72ef86b3c1`.

## 📄 Licencia

**GPL-3.0** — ver [LICENSE](LICENSE). © 2026 OptiSuite · por EnMaNueL-G.
