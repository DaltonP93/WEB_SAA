import { Route, Navigate, createRoutesFromElements } from "react-router-dom";
import AdminLayout from "./components/AdminLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import SettingsPage from "./pages/SettingsPage";
import PagesListPage from "./pages/PagesListPage";
import PageBuilderPage from "./pages/PageBuilderPage";
import DoctorsListPage from "./pages/DoctorsListPage";
import DoctorEditPage from "./pages/DoctorEditPage";
import SpecialtiesPage from "./pages/SpecialtiesPage";
import ServicesPage from "./pages/ServicesPage";
import StudiesPage from "./pages/StudiesPage";
import ContactChannelsPage from "./pages/ContactChannelsPage";
import SchedulesPage from "./pages/SchedulesPage";
import DataReadinessPage from "./pages/DataReadinessPage";
import AppointmentsPage from "./pages/AppointmentsPage";
import MenusPage from "./pages/MenusPage";
import ContactMessagesPage from "./pages/ContactMessagesPage";
import MediaPage from "./pages/MediaPage";
import UsersPage from "./pages/UsersPage";

function Protected({ children }: { children: JSX.Element }) {
  const t = localStorage.getItem("token");
  if (!t) return <Navigate to="/login" replace />;
  return children;
}

export const routes = createRoutesFromElements(
  <>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<Protected><AdminLayout /></Protected>}>
      <Route index element={<DashboardPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="pages" element={<PagesListPage />} />
      <Route path="pages/:id" element={<PageBuilderPage />} />
      <Route path="doctors" element={<DoctorsListPage />} />
      <Route path="doctors/new" element={<DoctorEditPage />} />
      <Route path="doctors/:id" element={<DoctorEditPage />} />
      <Route path="specialties" element={<SpecialtiesPage />} />
      <Route path="services" element={<ServicesPage />} />
      <Route path="studies" element={<StudiesPage />} />
      <Route path="contact-channels" element={<ContactChannelsPage />} />
      <Route path="schedules" element={<SchedulesPage />} />
      <Route path="datos-pendientes" element={<DataReadinessPage />} />
      <Route path="menus" element={<MenusPage />} />
      <Route path="turnos" element={<AppointmentsPage />} />
      <Route path="messages" element={<ContactMessagesPage />} />
      <Route path="media" element={<MediaPage />} />
      <Route path="users" element={<UsersPage />} />
    </Route>
  </>,
);
