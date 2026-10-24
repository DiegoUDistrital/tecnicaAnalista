## Título

<!-- Mismo formato que un commit convencional: tipo(ámbito): descripción en imperativo, hasta 72 caracteres -->

## ¿Qué cambia?

## ¿Por qué?

## ¿Cómo probarlo?

## Cobertura

<!-- Porcentaje de cobertura obtenido: -->

## Checklist de seguridad

- [ ] No se han subido secretos (`.env`, claves, credenciales)
- [ ] La entrada está validada (tipos, longitudes, UUID, campos desconocidos)
- [ ] El SQL está parametrizado
- [ ] Los errores no exponen detalles internos al cliente
- [ ] Se aplican permisos mínimos
- [ ] La API key no se expone al navegador

## Checklist de calidad

- [ ] `test` con cobertura >= 95 % en verde
- [ ] `lint` en verde
- [ ] `typecheck` en verde
- [ ] `build` en verde
- [ ] Commits convencionales en español
- [ ] README actualizado
