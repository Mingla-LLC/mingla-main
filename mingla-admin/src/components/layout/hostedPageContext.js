// Issue #4130 (Wave 0) — which hub tab a page is drawn in, if any.
//
// The Hosts and creators page (pages/HostsAndCreatorsHub.jsx) provides { page, tab, hosts } while it draws an older page as one of
// its tabs (the Hosts board inside Hosts and creators, at
// #/outreach?tab=hosts). useHashQuery reads it so the page keeps its own
// query inside the hub's address and needs no change. It carries no data from
// the server: only the address the page is drawn at.
import { createContext } from "react";

export const HostedPageContext = createContext(null);
