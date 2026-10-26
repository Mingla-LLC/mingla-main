// Issue #4130 (Wave 4b) — a page drawn inside another page's tab.
//
// Place pool, Team and roles and Platform health hold older pages (Launch
// Cities, the place tools, Careers, …) inside their own tabs. Those pages keep
// their <PageHeader>; under this context it draws only their actions and tabs,
// so the screen has one title (the holding page's) and one <h1>.
import { createContext } from "react";

export const EmbeddedPageContext = createContext(false);
