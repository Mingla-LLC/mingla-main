import type { ServerFunctionClient } from "payload";
import config from "@payload-config";
import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts";
import { importMap } from "./admin/importMap";
import "@payloadcms/next/css";
import "./studio.css";

type Props = { children: React.ReactNode };
const serverFunction: ServerFunctionClient = async (args) =>
  handleServerFunctions({ ...args, config, importMap });
export default function PayloadLayout({ children }: Props) {
  return (
    <RootLayout
      config={config}
      importMap={importMap}
      serverFunction={serverFunction}
    >
      {children}
    </RootLayout>
  );
}
