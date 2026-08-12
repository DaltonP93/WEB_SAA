import DoctorList from "../blocks/DoctorList";

export default function DoctorsPage() {
  return (
    <>
      <section className="bg-primary text-white py-12">
        <div className="container-x">
          <h1 className="text-3xl md:text-4xl font-bold">Conocé a nuestros médicos</h1>
          <p className="opacity-90 mt-1">
            Filtrá por especialidad o por médico y reservá tu turno.
          </p>
        </div>
      </section>
      <DoctorList showSearch />
    </>
  );
}
