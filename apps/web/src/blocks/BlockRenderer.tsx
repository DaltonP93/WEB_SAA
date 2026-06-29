import { lazy, Suspense } from "react";
import type { Block, BlockType } from "@sa/shared/blocks";
import type {
  HeroProps,
  RichTextProps,
  CardsProps,
  AccordionProps,
  SliderProps,
  GalleryProps,
  DoctorListProps,
  SpecialtyGridProps,
  ServiceGridProps,
  StudyGridProps,
  NewsGridProps,
  MapEmbedProps,
  VideoEmbedProps,
  ContactFormProps,
  AppointmentFormProps,
  CtaProps,
  StatsProps,
  LogosProps,
  SpacerProps,
} from "@sa/shared/blocks";

const Hero = lazy(() => import("./Hero"));
const RichText = lazy(() => import("./RichText"));
const Cards = lazy(() => import("./Cards"));
const Accordion = lazy(() => import("./Accordion"));
const Slider = lazy(() => import("./Slider"));
const Gallery = lazy(() => import("./Gallery"));
const DoctorList = lazy(() => import("./DoctorList"));
const SpecialtyGrid = lazy(() => import("./SpecialtyGrid"));
const ServiceGrid = lazy(() => import("./ServiceGrid"));
const StudyGrid = lazy(() => import("./StudyGrid"));
const NewsGrid = lazy(() => import("./NewsGrid"));
const MapEmbed = lazy(() => import("./MapEmbed"));
const VideoEmbed = lazy(() => import("./VideoEmbed"));
const ContactForm = lazy(() => import("./ContactForm"));
const AppointmentForm = lazy(() => import("./AppointmentForm"));
const Cta = lazy(() => import("./Cta"));
const Stats = lazy(() => import("./Stats"));
const Logos = lazy(() => import("./Logos"));
const Spacer = lazy(() => import("./Spacer"));

type BlockPropsMap = {
  hero: HeroProps;
  richText: RichTextProps;
  cards: CardsProps;
  accordion: AccordionProps;
  slider: SliderProps;
  gallery: GalleryProps;
  doctorList: DoctorListProps;
  specialtyGrid: SpecialtyGridProps;
  serviceGrid: ServiceGridProps;
  studyGrid: StudyGridProps;
  newsGrid: NewsGridProps;
  mapEmbed: MapEmbedProps;
  videoEmbed: VideoEmbedProps;
  contactForm: ContactFormProps;
  appointmentForm: AppointmentFormProps;
  cta: CtaProps;
  stats: StatsProps;
  logos: LogosProps;
  spacer: SpacerProps;
};

const MAP: Record<BlockType, React.ComponentType<any>> = {
  hero: Hero,
  richText: RichText,
  cards: Cards,
  accordion: Accordion,
  slider: Slider,
  gallery: Gallery,
  doctorList: DoctorList,
  specialtyGrid: SpecialtyGrid,
  serviceGrid: ServiceGrid,
  studyGrid: StudyGrid,
  newsGrid: NewsGrid,
  mapEmbed: MapEmbed,
  videoEmbed: VideoEmbed,
  contactForm: ContactForm,
  appointmentForm: AppointmentForm,
  cta: Cta,
  stats: Stats,
  logos: Logos,
  spacer: Spacer,
};

export default function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <Suspense fallback={<div className="container-x py-10">Cargando…</div>}>
      {blocks.map((b) => {
        const C = MAP[b.type];
        if (!C) return <div key={b.id} className="container-x py-3 text-sm text-red-600">Bloque desconocido: {b.type}</div>;
        return <C key={b.id} {...(b.props as any)} />;
      })}
    </Suspense>
  );
}
