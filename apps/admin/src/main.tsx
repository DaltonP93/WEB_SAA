import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { routes } from "./App";
import { ConfirmProvider } from "./components/ConfirmDialog";
import "./styles.css";

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

// Los flags `future` v7_* eran el opt-in de React Router 6 al comportamiento
// de la v7; con la v7 instalada ya es el único y la opción no existe.
const router = createBrowserRouter(routes, {
  basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/",
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <Toaster position="top-right" />
        <RouterProvider router={router} />
      </ConfirmProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
