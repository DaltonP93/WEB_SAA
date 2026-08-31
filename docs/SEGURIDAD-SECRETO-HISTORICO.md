# Rotación y purga segura del historial

> Procedimiento público y saneado. **No fue ejecutado.**
>
> Los valores, fingerprints, cuentas afectadas y evidencias exactas se mantienen
> fuera de Git en el registro privado del incidente. Nunca deben copiarse a este
> archivo, PRs, issues, chats, logs ni comandos visibles.

## 1. Alcance

La auditoría confirmó credenciales históricas que ya no están en el árbol
actual, pero permanecen alcanzables en objetos Git antiguos. Un escáner
automático no sustituye el inventario privado: patrones que no coinciden con
sus reglas pueden seguir siendo credenciales válidas.

Hasta rotar todos los accesos afectados, purgar la historia y verificar clones,
forks y caches, producción permanece en **NO-GO**.

## 2. Condiciones previas

- [ ] propietario e incident commander identificados;
- [ ] merges y pushes congelados durante la ventana;
- [ ] inventario privado de credenciales, ramas, tags, forks, clones y runners;
- [ ] accesos alternativos nuevos probados antes de invalidar los anteriores;
- [ ] backup cifrado y offline del repositorio remoto;
- [ ] backup verificado de base de datos y archivos persistentes;
- [ ] plan para restaurar las protecciones de `main` inmediatamente;
- [ ] responsables de validar GitHub, infraestructura, API y panel al terminar.

## 3. Rotar antes de purgar

1. Crear accesos nominales nuevos y verificar sus fingerprints por un canal
   independiente.
2. Probar el acceso nuevo en una sesión paralela antes de cerrar la anterior.
3. Revisar accesos, llaves, usuarios y roles; investigar actividad no reconocida.
4. Rotar todas las credenciales del inventario privado y cualquier
   reutilización.
5. Invalidar sesiones administrativas vigentes mediante la rotación del secreto
   de firma correspondiente.
6. Deshabilitar autenticación por contraseña donde exista una alternativa por
   llave.
7. Confirmar que accesos viejos ya no funcionan y que los nuevos sí.

No publicar resultados que incluyan valores, hashes reutilizables, usernames,
hosts internos ni contenido de archivos de entorno.

## 4. Preparar la reescritura

Trabajar en una estación aislada y actualizada, nunca sobre el servidor activo.

```bash
git clone --mirror <url-del-repositorio> repo-purge.git
cd repo-purge.git
git show-ref > ../refs-antes.txt
git bundle create ../repo-antes.bundle --all
```

Guardar el bundle cifrado y offline: contiene precisamente la historia que se
quiere retirar.

Crear fuera del repositorio un archivo `replacements.txt` con los valores
exactos obtenidos del gestor de secretos. El formato conceptual es:

```text
literal:<valor-historico-1>==>***REMOVED-CREDENTIAL-1***
literal:<valor-historico-2>==>***REMOVED-CREDENTIAL-2***
```

Los marcadores no son valores reales. Proteger y borrar el archivo al terminar:

```bash
chmod 600 ../replacements.txt
git filter-repo --force --replace-text ../replacements.txt
rm -f ../replacements.txt
```

## 5. Verificar antes del push

```bash
gitleaks detect --config .gitleaks.toml --redact --verbose
git fsck --full --no-reflogs
git show-ref > ../refs-despues.txt
```

Además:

- buscar cada valor del inventario privado sin imprimir coincidencias ni
  guardarlas en logs;
- confirmar que ramas y tags esperados continúan;
- ejecutar tests y CI sobre la historia reescrita;
- comprobar que los reemplazos no alteraron contenido ajeno.

Si algo falla antes del push, descartar el mirror de trabajo. El remoto aún no
cambió.

## 6. Publicar la historia nueva

Requiere autorización explícita del propietario:

1. mantener congelados merges y automatizaciones;
2. permitir temporalmente sólo el force-push coordinado;
3. publicar ramas y tags revisados; no usar `git push --mirror` sin comparar
   refs, porque puede borrar referencias remotas;
4. restaurar inmediatamente el ruleset de `main`;
5. ejecutar CI y repetir los escaneos de árbol e historial;
6. solicitar limpieza de caches/objetos al proveedor si siguen accesibles;
7. invalidar PRs incompatibles y recrearlos desde la historia nueva.

## 7. Clones, forks y runners

Todos deben **reclonar**. Un pull o rebase desde un clon viejo puede reintroducir
los objetos retirados.

- inventariar estaciones, servidores, runners, forks y mirrors;
- preservar sólo archivos no versionados desde fuentes verificadas;
- borrar los clones viejos y reclonar;
- limpiar caches y artefactos de CI;
- impedir que remotos antiguos vuelvan a empujar.

## 8. Criterios de cierre

- [ ] todos los accesos afectados y reutilizados fueron rotados;
- [ ] sesiones antiguas invalidadas y usuarios revisados;
- [ ] autenticación por contraseña deshabilitada donde corresponde;
- [ ] escaneo del árbol y la historia reescrita sin hallazgos;
- [ ] búsqueda privada de cada valor sin coincidencias;
- [ ] `main` protegido y CI verde;
- [ ] clones, forks, runners y caches tratados;
- [ ] evidencia privada firmada por responsables y fecha.

Hasta cumplir todo, el estado permanece **NO-GO**.

## 9. Recuperación

- Antes del push: descartar el mirror de trabajo.
- Después del push: mantener el freeze y repetir desde el bundle offline.
- Restaurar la historia vieja sólo como último recurso aprobado, porque
  reintroduce las credenciales; si ocurre, rotar otra vez.
- No usar el servidor activo como copia maestra del repositorio.
