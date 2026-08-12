import EntityManager from "../components/EntityManager";

export default function StudiesPage() {
  return (
    <EntityManager
      title="Estudios"
      endpoint="/admin/studies"
      cacheKey="adm-studies"
      reorderable
      fields={[
        { key: "name", label: "Nombre" },
        { key: "category", label: "Categoría", kind: "select", options: [
          { value: "laboratorio", label: "Laboratorio" },
          { value: "imagenes", label: "Estudios por imágenes" },
          { value: "cardiologicos", label: "Estudios cardiológicos" },
          { value: "biopsias", label: "Biopsias / anatomía patológica" },
        ] },
        { key: "icon", label: "Icono", kind: "icon" },
        { key: "description", label: "Descripción", kind: "textarea" },
        { key: "body", label: "Cuerpo (HTML)", kind: "textarea" },
      ]}
    />
  );
}
