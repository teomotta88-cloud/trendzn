import { createFileRoute, redirect } from "@tanstack/react-router";
import { IHC_BRANDS } from "@/lib/editorialPlan";

export const Route = createFileRoute("/piani-editoriali-ihc/")({
  beforeLoad: () => {
    throw redirect({ to: "/piani-editoriali-ihc/$brand", params: { brand: IHC_BRANDS[0].slug } });
  },
});
