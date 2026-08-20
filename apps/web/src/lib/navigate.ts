/**
 * Salida del sitio hacia un destino externo.
 *
 * Existe como función propia por dos motivos.
 *
 * **Navegación, no popup.** `window.open()` después de un `await` ya no cuenta
 * como respuesta a un gesto del usuario: el navegador lo trata como una
 * ventana emergente y la bloquea. El formulario de turnos registra la solicitud
 * en la API y **después** manda a WhatsApp, así que ahí la pestaña nueva se
 * pierde justo cuando más importa. Una navegación de primer nivel en la misma
 * pestaña no se bloquea nunca.
 *
 * **Y para poder probarlo.** jsdom no implementa la navegación y lanza si algo
 * asigna `window.location`. Con la salida detrás de esta función, una prueba de
 * componente la reemplaza y comprueba el destino sin pelearse con el entorno.
 */
export function irA(url: string): void {
  window.location.assign(url);
}
