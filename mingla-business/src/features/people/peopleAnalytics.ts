import { Platform } from "react-native";
import { postHogService } from "../../services/postHogService";
import { captureWeb } from "../../analytics/webAnalytics";
export type PeopleEvent="people_page_viewed"|"people_book_opened"|"people_book_search_used"|"people_add_opened"|"people_add_completed"|"people_add_review_required"|"people_import_selected"|"people_dependency_state_viewed"|"people_group_opened"|"people_legacy_audiences_redirected"|"people_conflict_queue_opened"|"people_conflict_resolved"|"people_conflict_resolve_failed";
export interface PeopleEventProperties {platform?:string;surface?:"page"|"book_sheet"|"detail"|"add_sheet"|"groups_sheet"|"conflict_sheet";result?:"created"|"updated"|"unchanged"|"review";dependency?:"import"|"export"|"reach"|"followers"|"extended";dependencyState?:"available"|"unavailable"|"flag_off";hasSearch?:boolean;bookSizeBucket?:"0"|"1_10"|"11_50"|"51_100"|"101_plus";groupKind?:string;errorCode?:string;/* #2305 — `resolution`, `candidateCount` and `matchedOn` are the only way to learn
 * empirically whether operators separate more often on a single-channel match than on a
 * two-channel one, which answers SPEC 11-Q2 with data instead of intuition. `matchedOn`
 * carries the CHANNEL that matched, never the value that matched — no identity or
 * contact data enters analytics (#1774). */
resolution?:"merge"|"separate"|"dismiss";candidateCount?:number;matchedOn?:string;dismissedReason?:string}
export function capturePeople(event:PeopleEvent,properties:PeopleEventProperties={}):void{const safe={platform:Platform.OS,...properties};postHogService.capture(event,safe);if(Platform.OS==="web")captureWeb(event,safe);}
