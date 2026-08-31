import { lazy, Suspense } from "react";
import type { Block, BlockType } from "@sa/shared/blocks";
import PageSkeleton from "../components/PageSkeleton";
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
  MapEmbedProps,
  VideoEmbedProps,
  ContactFormProps,
  AppointmentFormProps,
  ContactChannelsProps,
  SocialLinksProps,
  StepsProps,
  ScheduleTableProps,
  CtaProps,
  StatsProps,
  LogosProps,
  NewsletterProps,
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
const MapEmbed = lazy(() => import("./MapEmbed"));
const VideoEmbed = lazy(() => import("./VideoEmbed"));
const ContactForm = lazy(() => import("./ContactForm"));
const AppointmentForm = lazy(() => import("./AppointmentForm"));
const ContactChannels = lazy(() => import("./ContactChannels"));
const SocialLinks = lazy(() => import("./SocialLinks"));
const Steps = lazy(() => import("./Steps"));
const ScheduleTable = lazy(() => import("./ScheduleTable"));
const Cta = lazy(() => import("./Cta"));
const Stats = lazy(() => import("./Stats"));
const Logos = lazy(() => import("./Logos"));
const Newsletter = lazy(() => import("./Newsletter"));
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
  mapEmbed: MapEmbedProps;
  videoEmbed: VideoEmbedProps;
  contactForm: ContactFormProps;
  appointmentForm: AppointmentFormProps;
  contactChannels: ContactChannelsProps;
  socialLinks: SocialLinksProps;
  steps: StepsProps;
  scheduleTable: ScheduleTableProps;
  cta: CtaProps;
  stats: StatsProps;
  logos: LogosProps;
  newsletter: NewsletterProps;
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
  mapEmbed: MapEmbed,
  videoEmbed: VideoEmbed,
  contactForm: ContactForm,
  appointmentForm: AppointmentForm,
  contactChannels: ContactChannels,
  socialLinks: SocialLinks,
  steps: Steps,
  scheduleTable: ScheduleTable,
  cta: Cta,
  stats: Stats,
  logos: Logos,
  newsletter: Newsletter,
  spacer: Spacer,
};

export default function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <Suspense fallback={<PageSkeleton variant="section" />}>
      {blocks.map((b) => {
        const C = MAP[b.type];
        if (!C) return <div key={b.id} className="container-x py-3 text-sm text-amber-700">Bloque desconocido: {b.type}</div>;
        return <C key={b.id} {...(b.props as any)} />;
      })}
    </Suspense>
  );
}
