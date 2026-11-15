/* Lectura de ME45: independiente de los importadores y del estado guardado. */
function decodeWorkoutBase45(text){
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  if(!text.length || text.length % 3 === 1) throw Error("Longitud Base45 inválida.");

  const bytes = [];
  // El espacio pertenece al alfabeto Base45: no usar trim ni quitar espacios.
  for(let i = 0; i < text.length; i += 3){
    const count = Math.min(3, text.length - i);
    let value = 0;
    for(let j = 0; j < count; j++){
      const digit = alphabet.indexOf(text[i + j]);
      if(digit < 0) throw Error("El contenido Base45 tiene caracteres inválidos.");
      value += digit * (45 ** j);
    }
    if(value > (count === 3 ? 65535 : 255)) throw Error("Valor Base45 fuera de rango.");
    if(count === 3) bytes.push(value >> 8);
    bytes.push(value & 255);
  }
  return new Uint8Array(bytes);
}

function decompressWorkoutQr(payload){
  const compressed = decodeWorkoutBase45(payload);
  // windowBits: 15 exige el contenedor zlib (no gzip ni deflate crudo).
  const inflater = new pako.Inflate({ windowBits: 15 });
  inflater.push(compressed, true);
  if(inflater.err || !inflater.ended || !inflater.result){
    throw Error("Los datos zlib están incompletos o dañados.");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(inflater.result);
}

function openCompressedQrReader(){
  const dialog = document.createElement("dialog");
  dialog.className = "qrDialog";
  dialog.setAttribute("aria-labelledby", "compressedQrTitle");
  dialog.innerHTML = `
    <section class="modal qrReader">
      <h3 id="compressedQrTitle">Leer QR comprimido</h3>
      <p class="muted">Escaneá el QR o elegí un PNG desde Fotos o Archivos. El resultado se muestra sin guardar la rutina.</p>
      <div class="qrReader__actions">
        <button type="button" class="btn btn--primary" data-qr-camera>Escanear con cámara</button>
        <button type="button" class="btn" data-qr-file>Seleccionar PNG</button>
        <button type="button" class="btn" data-qr-stop hidden>Detener cámara</button>
      </div>
      <input type="file" accept="image/png,.png" data-qr-input hidden />
      <video class="qrReader__camera" autoplay muted playsinline hidden aria-label="Vista previa de la cámara"></video>
      <p class="muted" role="status" aria-live="polite" data-qr-status></p>
      <p role="alert" data-qr-error></p>
      <label class="field" data-qr-result hidden>
        <span>Texto UTF-8 de la rutina</span>
        <textarea class="input qrReader__text" rows="12" readonly spellcheck="false"></textarea>
      </label>
      <div class="modal__actions">
        <button type="button" class="btn" data-qr-close>Cerrar</button>
      </div>
    </section>
  `;
  document.body.appendChild(dialog);

  const cameraButton = dialog.querySelector("[data-qr-camera]");
  const fileButton = dialog.querySelector("[data-qr-file]");
  const stopButton = dialog.querySelector("[data-qr-stop]");
  const fileInput = dialog.querySelector("[data-qr-input]");
  const video = dialog.querySelector("video");
  const status = dialog.querySelector("[data-qr-status]");
  const error = dialog.querySelector("[data-qr-error]");
  const result = dialog.querySelector("[data-qr-result]");
  const output = dialog.querySelector("textarea");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let stream = null;
  let cameraPending = false;
  let scanTimer = null;
  let operation = 0;

  function resetResult(){
    status.textContent = "";
    error.textContent = "";
    output.value = "";
    result.hidden = true;
  }

  function stopCamera(){
    operation++;
    clearTimeout(scanTimer);
    if(stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    cameraPending = false;
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    stopButton.hidden = true;
    cameraButton.disabled = false;
    fileButton.disabled = false;
  }

  function readPixels(source, width, height){
    canvas.width = width;
    canvas.height = height;
    // Un PNG transparente debe verse sobre blanco, no sobre negro.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    return jsQR(pixels.data, width, height, { inversionAttempts: "attemptBoth" });
  }

  function showPayload(payload){
    stopCamera();
    resetResult();
    if(!payload.startsWith("ME45:")){
      error.textContent = "No se pudo leer el QR comprimido: el contenido no empieza con ME45:.";
      return;
    }
    try{
      output.value = decompressWorkoutQr(payload.slice(5));
      result.hidden = false;
      status.textContent = "QR leído y descomprimido. La rutina no se guardó.";
    }catch(err){
      error.textContent = "Falló la descompresión del QR. " + (err.message || "El contenido no es válido.");
    }
  }

  cameraButton.onclick = async () => {
    stopCamera();
    resetResult();
    if(!navigator.mediaDevices?.getUserMedia){
      error.textContent = "No se pudo leer el QR con la cámara: requiere HTTPS o localhost y un navegador compatible. Podés seleccionar un PNG.";
      return;
    }
    const currentOperation = operation;
    cameraPending = true;
    cameraButton.disabled = true;
    stopButton.hidden = false;
    status.textContent = "Solicitando acceso a la cámara…";
    try{
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      if(!dialog.open || currentOperation !== operation){
        cameraStream.getTracks().forEach(track => track.stop());
        return;
      }
      stream = cameraStream;
      cameraPending = false;
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      if(!dialog.open || currentOperation !== operation) return;
      status.textContent = "Buscando un QR. Acercalo y mantenelo dentro de la imagen; si no se lee, probá seleccionar un PNG.";

      function scan(){
        if(!dialog.open || currentOperation !== operation) return;
        try{
          if(video.readyState >= 2 && video.videoWidth && video.videoHeight){
            const code = readPixels(video, video.videoWidth, video.videoHeight);
            if(code){
              showPayload(code.data);
              return;
            }
          }
          scanTimer = setTimeout(scan, 250);
        }catch{
          stopCamera();
          status.textContent = "";
          error.textContent = "No se pudo leer el QR con la cámara. Probá seleccionar un PNG.";
        }
      }
      scan();
    }catch(err){
      if(!dialog.open || currentOperation !== operation) return;
      stopCamera();
      status.textContent = "";
      error.textContent = err.name === "NotAllowedError"
        ? "No se pudo leer el QR: no se habilitó el acceso a la cámara. Podés seleccionar un PNG."
        : "No se pudo leer el QR: no se pudo iniciar la cámara. Podés seleccionar un PNG.";
    }
  };

  stopButton.onclick = () => {
    stopCamera();
    status.textContent = "Cámara detenida.";
  };
  fileButton.onclick = () => {
    stopCamera();
    status.textContent = "Elegí un PNG desde Fotos o Archivos.";
    fileInput.value = "";
    fileInput.click();
  };
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if(!file) return;
    stopCamera();
    resetResult();
    if(file.type !== "image/png" && !/\.png$/i.test(file.name)){
      error.textContent = "No se pudo leer el QR: seleccioná un archivo PNG.";
      return;
    }
    const currentOperation = operation;
    cameraButton.disabled = true;
    fileButton.disabled = true;
    status.textContent = "Leyendo QR del PNG…";
    const url = URL.createObjectURL(file);
    try{
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      if(!dialog.open || currentOperation !== operation) return;
      const code = readPixels(image, image.naturalWidth, image.naturalHeight);
      if(!code) throw Error("No se encontró un QR legible en el PNG.");
      showPayload(code.data);
    }catch{
      if(dialog.open && currentOperation === operation){
        status.textContent = "";
        error.textContent = "No se pudo leer el QR del PNG. Probá una imagen más nítida que incluya el código completo.";
      }
    }finally{
      URL.revokeObjectURL(url);
      if(currentOperation === operation){
        cameraButton.disabled = false;
        fileButton.disabled = false;
      }
    }
  };

  function suspendCamera(){
    if(stream || cameraPending){
      stopCamera();
      status.textContent = "Cámara detenida. Podés volver a escanear.";
    }
  }
  function onVisibilityChange(){
    if(document.hidden) suspendCamera();
  }
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", suspendCamera);
  dialog.querySelector("[data-qr-close]").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    stopCamera();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", suspendCamera);
    dialog.remove();
  }, { once: true });
  dialog.showModal();
}
