import 'server-only'

import { LAGOS_INTENT_PLANS } from '@/lib/lagos-intent-plans'
import {
  EXPLORER_CATEGORIES,
  type CataloguePlace,
  type CataloguePlan,
  type ExplorerCategorySlug,
} from '@/content/page-system/shared'

const CITY_PATH = '/internal/page-system/city-lagos'
const PHOTO_BASE = 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos'
const SOURCE_UPDATED_AT = '2026-08-07'

const SCORE_TIMESTAMPS: Record<ExplorerCategorySlug, string> = {
  nature: '2026-06-01T15:58:09.171Z',
  icebreakers: '2026-06-01T15:58:13.771Z',
  drinks: '2026-06-01T15:57:59.614Z',
  brunch: '2026-06-01T15:58:02.020Z',
  casual_food: '2026-06-01T15:58:04.634Z',
  fine_dining: '2026-06-01T15:57:57.955Z',
  movies: '2026-06-01T15:58:07.784Z',
  theatre: '2026-06-01T15:58:06.177Z',
  creative_arts: '2026-06-01T15:58:12.123Z',
  play: '2026-06-01T15:58:11.003Z',
}

type PlaceSnapshotRow = readonly [
  placePoolId: string,
  name: string,
  categorySlug: ExplorerCategorySlug,
  signalScore: number,
  aiBlended: boolean,
  photoPath: string,
  rating: number | null,
  reviewCount: number | null,
  address: string | null,
]

// Read-only production snapshot captured through the same eligibility and per-signal
// ordering contract used by Explorer on 2 September 2026. The rows are stored in
// five round-robin passes, one place per category per pass, so the default page is
// balanced rather than globally sorted toward one rich category.
const LAGOS_PLACE_SNAPSHOT: readonly PlaceSnapshotRow[] = [
  ['ba952a16-1b52-4f23-ba4c-3aa8741d8a33', 'Lekki Conservation Centre', 'nature', 188.3, true, 'ChIJnfWgLfn2OxARZjghHw4IIMA/0.jpg', 4.3, 14381, 'Km 19 Lekki - Epe Expy, Lekki Penninsula II, Lekki 106104, Lagos, Nigeria'],
  ['681d7da5-066d-40f0-9eab-6369771a54e7', 'Café One VI', 'icebreakers', 182, true, 'ChIJ4f90dLOxARIy2UVvQDbNA/0.jpg', 4.6, 81, '300 Adeola Odeku St, Victoria Island, Lagos 101241, Lagos, Nigeria'],
  ['d9ebabd5-d322-47bd-9b08-ecf724658a59', 'Decode lounge', 'drinks', 200, false, 'ChIJFy2wUeP1OxARBWP4oRFrxPo/0.jpg', 4.4, 103, '25 Fola Osibo Rd, Eti-Osa, Lekki 101233, Lagos, Nigeria'],
  ['1b174cfb-dd47-48dc-b966-e2a14a7875b5', 'Blacks & Cooper’s', 'brunch', 194, true, 'ChIJ-yM1FE31OxARO3_WEi19A1w/0.jpg', 4, 76, '22 Victoria Arobieke St, Lekki Phase 1, Lekki 105102, Lagos, Nigeria'],
  ['3aacd546-d162-4c49-bf3f-838441fba5ff', 'Shiro Lagos', 'casual_food', 200, false, 'ChIJ8zWFqBb1OxARbb9xPZcXj2E/0.jpg', 4.4, 1794, 'Oniru Estate, Block XVI 3 & 4, Victoria Island, Lagos 101241, Lagos, Nigeria'],
  ['f23212ce-41dd-4555-9dee-08ae1f0ec175', 'ATIJE', 'fine_dining', 194, true, 'ChIJo1m2qk6LOxARd6L8FZG0w2M/0.jpg', 5, 21, '14F OBI ACHEBE DRIVE, Edgewater Estate, Lagos 106104, Lagos, Nigeria'],
  ['cf8ab0ef-a9c6-4d0d-9014-67c4d6d5c045', 'The Pod, Nile Luxury Cinemas', 'movies', 166.2, true, 'ChIJy3WDHAD1OxAR6_r-LPiCV8s/0.jpg', 5, 19, 'CCMQ+V43, Bishop Aboyade Cole St, Victoria Island, Lagos 106104, Lagos, Nigeria'],
  ['87d54d04-e71b-40af-b3e6-b2e8540ffe3f', 'Ayanjo Dance Company', 'theatre', 167.5, true, 'ChIJb41rt6qOOxARlv9c0BHxDZg/0.jpg', 4.8, 57, 'Ogudu Road, LGA, Kosofe, Lagos 100242, Lagos, Nigeria'],
  ['a9a893b3-0cb9-45f0-a00b-9a867a3c92a6', 'Nike Art Gallery', 'creative_arts', 194, true, 'ChIJecHJJP_0OxARsqN_e4LH4rQ/0.jpg', 4.7, 7437, '2 Nike Art Gallery Rd, Lekki Phase I, Lekki 106104, Lagos, Nigeria'],
  ['a527b1a0-bb25-4f00-8015-3099c2edcb43', 'Dream Park and Gardens', 'play', 179.8, true, 'ChIJ7f0vkunvOxARAErwKGQjeM0/0.jpg', 4.2, 816, '7 Adeboro Street, by Hilltop Estate, Ikorodu 104101, Lagos, Nigeria'],

  ['4a38e608-e935-4696-9f8f-4b15fb87b8cc', 'Freedom Park Lagos', 'nature', 179.5, true, 'ChIJaaKZyRmLOxARR-nEcxQBEQ4/0.jpg', 4.2, 5733, "Old Prison Ground, 1 Hospital Road, Lagos Island, Lagos 102273, Nigeria"],
  ['000522db-fa7d-4483-b144-8acbaa0624b5', 'Café One UNILAG', 'icebreakers', 170, true, 'ChIJ2-rk7lCNOxARILfJ8jZWZdc/0.jpg', 4.6, 55, 'University of Lagos Main Campus, Akoka, Yaba, Lagos 101017, Nigeria'],
  ['0d2a9398-0659-4f33-8c87-7b7f739c12b4', 'ZAZA Lagos', 'drinks', 194, true, 'ChIJE2wWZlmLOxARaU95ssPAJ_g/0.jpg', 4.5, 984, '19 Agoro Odiyan St, Victoria Island, Lagos 106104, Nigeria'],
  ['0763eca3-43c3-4054-b1b7-5571ca5986bc', 'Flowershop Cafe', 'brunch', 188, true, 'ChIJeX5km5n1OxARa7l-maEUPIw/0.jpg', 4.5, 1352, '274 Akin Adesola St, Victoria Island, Lagos 106104, Nigeria'],
  ['347fa284-f0a3-403f-8481-04b4302f9f6f', 'Spring Tree Chinese Restaurant', 'casual_food', 194, true, 'ChIJs8s41lfvOxARbV2k_aHoT9M/0.jpg', 4.5, 154, '78 Ayangburen Rd, Ikorodu, Lagos 104101, Nigeria'],
  ['214eb347-93c2-47b5-8a24-8481438f5f56', 'Izanagi Japanese Cuisine', 'fine_dining', 182, true, 'ChIJ47AVd86KOxARmKbgSTD8IHM/0.jpg', 4.4, 682, '19B Idejo St, Victoria Island, Lagos 101241, Nigeria'],
  ['082a74c8-831c-4394-a9b4-9a0b8e3ea032', 'Genesis Deluxe Cinemas Maryland', 'movies', 161.7, true, 'ChIJG-WGxxWTOxARA_10DP8tN4E/0.jpg', 4.2, 7350, 'Maryland Mall, Ikorodu Rd, Ikeja 105102, Lagos, Nigeria'],
  ['80dc8c15-e2d5-4fab-99d9-a2c985329e53', 'New Afrika Shrine', 'theatre', 160, true, 'ChIJe0nKVMaTOxAR8RkbgoPo_0g/0.jpg', 4.4, 3886, '1 NERDC Rd, Agidingbi, Ikeja 101233, Lagos, Nigeria'],
  ['ed9450c4-dbaf-4eda-b5b5-fc9544b2af5c', 'Yenwa Art Gallery', 'creative_arts', 194, true, 'ChIJhQxpls_1OxARc4XbRSmQ0OI/0.jpg', 4.9, 253, '1–7 Muri Okunola St, Victoria Island, Lagos 106104, Nigeria'],
  ['97aa4d72-8e38-49f1-96c3-118c680a7d7f', 'Hakuna Matata Theme Park By Eko Hotels', 'play', 178.8, true, 'ChIJozcTQv2LOxARDESDAV851LI/0.jpg', 4.4, 246, 'Eko Atlantic City, Ahmadu Bello Way, Victoria Island, Lagos 106104, Nigeria'],

  ['120b3f6a-bb91-4ce2-8dd9-aaa996456c0a', 'Jhalobia Landscaping Company and Botanical Garden', 'nature', 165.6, true, 'ChIJRZM7uRGOOxARsffV1XScHBo/0.jpg', 4.2, 596, 'Airport Rd, Ikeja 102214, Lagos, Nigeria'],
  ['93715af2-ebf7-48b4-857c-aec2e4981d90', 'Olori Art Foundation', 'icebreakers', 170, true, 'ChIJIWsx7Tb1OxARzhCu3mLGU-w/0.jpg', 4.9, 279, '139 Josemaria Escriva St, Lekki Phase I, Lagos 106104, Nigeria'],
  ['251ddef5-6fc6-4e39-8cf1-f64ca6a6be00', 'Above Lifestyle', 'drinks', 194, true, 'ChIJ0xJ7JKn3OxARulmEj5IE6io/0.jpg', 4.8, 603, 'Hon. Yaya Dosunmu Way, Lekki Penninsula II, Lagos 106104, Nigeria'],
  ['394ccf3a-c5a9-4e7d-b1e2-0cd9cbaba3b8', 'Brisk', 'brunch', 188, true, 'ChIJPQ9ZeyL1OxARylVxBWVvuss/0.jpg', 4.4, 459, '1 Alfred Rewane Rd, Ikoyi, Lagos 106104, Nigeria'],
  ['635794c1-ef12-4209-a846-4a1f37983ccc', 'Panarottis Admiralty', 'casual_food', 194, true, 'ChIJz8EYx9X1OxARj32N61r7PPk/0.jpg', 4.4, 827, 'Delakes Mall, Admiralty Way, Lekki Phase 1, Lagos 105102, Nigeria'],
  ['2f612a84-73cb-42c7-9847-5ca87052f9b9', 'The Scope by PIER Lagos', 'fine_dining', 182, true, 'ChIJKd_E2gWNOxARK-a0JYgJzwo/0.jpg', 4.6, 212, '14 Montgomery Rd, Yaba, Lagos 101245, Nigeria'],
  ['b36741b7-383a-4d93-970b-0c775d007423', 'Filmhouse Cinemas Surulere', 'movies', 161.6, true, 'ChIJyz9VCA2MOxARRAKobRYVKpc/0.jpg', 4.2, 6134, '30B Adeniran Ogunsanya St, Surulere, Lagos 101241, Nigeria'],
  ['681dcec2-1937-4f62-8f0e-89fcb8afc240', 'CrEd Lagos Island', 'theatre', 149.7, true, 'ChIJ8e1qd3KLOxAR0SFJzlFFTik/0.jpg', 4.5, 6, 'Bourdillon Rd, Ikoyi, Lagos 100001, Nigeria'],
  ['1bb0a383-3e04-4ed2-8687-c03e03657875', 'Didi Museum', 'creative_arts', 184.5, true, 'ChIJmxQcFiz1OxARkLf8Fwaki6c/0.jpg', 4.4, 173, '175A Akin Adesola St, Victoria Island, Lagos 106104, Nigeria'],
  ['b9e16f14-c60d-4331-93ce-716bbae2e2fb', 'Fun Factory', 'play', 174.1, true, 'ChIJiZnI4AH1OxAR4IYrCwvVjfI/0.jpg', 4.2, 1186, '10 Lai Yusuf Crescent, Admiralty Way, Lekki Phase 1, Lagos 106104, Nigeria'],

  ['d75085b6-799c-42fb-8406-96e5b846e018', 'Ndubuisi Kanu Park', 'nature', 161.6, true, 'ChIJJ359xLOTOxAROHlDy_ldHuA/0.jpg', 4.1, 6031, 'Mobolaji Johnson Ave, Oregun, Ikeja 101233, Lagos, Nigeria'],
  ['ae54029f-edbf-4a6b-a5f7-4c0eef41498b', 'Glazes and Ganache', 'icebreakers', 170, true, 'ChIJuVrVc5L1OxAR2N_QX_6wYDY/0.jpg', 4.9, 29, '8B Abeke Animashaun St, Lekki Phase I, Lagos 101206, Nigeria'],
  ['25e259df-fbe0-4914-a2cd-a2e16f8a2101', 'TheVIBE Lagos', 'drinks', 194, true, 'ChIJZ27mHzb1OxAR-8xrXBD0mFA/0.jpg', 4.4, 1159, '16B Akin Olugbade St, Victoria Island, Lagos 101241, Nigeria'],
  ['5a49b36a-432b-43ec-b542-0cbd05f73b08', 'Meraki On Muse', 'brunch', 188, true, 'ChIJP37fSPD1OxARTch-NlJhRBc/0.jpg', 4.6, 9, 'Plot 12, Block 58 Hunponu-Wusu Rd, Lekki Phase 1, Lagos 101233, Nigeria'],
  ['daafe2c9-3976-4da9-9ee4-f8d264df0240', 'Panarottis Ogudu', 'casual_food', 194, true, 'ChIJ25v2BMqTOxARqTwfm3rW8kU/0.jpg', 4.3, 152, '126 Ogudu Rd, Ogudu, Lagos 100242, Nigeria'],
  ['f22f0a95-b032-46b6-816b-e71d1768990e', 'Noir Lagos', 'fine_dining', 176, true, 'ChIJf37Oqy31OxAR9MFFkjaEvCE/0.jpg', 4.4, 792, '4A Akin Olugbade St, Victoria Island, Lagos 101241, Nigeria'],
  ['a416851e-a685-4d41-a4c7-3f87ad86aeaa', 'Silverbird Cinemas - Ikeja', 'movies', 161.3, true, 'ChIJKQ9m5SKTOxAR8qUrS5kCovk/0.jpg', 4.2, 4267, 'Ikeja City Mall, 174–194 Obafemi Awolowo Way, Lagos 101233, Nigeria'],
  ['1f41706f-966c-4607-a0a9-898865ff3a8b', 'Eden Event Hall', 'theatre', 149.6, true, 'ChIJqd_3Db2fOxARJaasHLDVFSE/0.jpg', 4.6, 5, 'Eden Hotel, opposite Chelsea Bus Stop, Ota 112233, Ogun State, Nigeria'],
  ['4f424eee-72d6-43e0-b276-3139dacc427c', 'Kingdom’s Art', 'creative_arts', 178.2, true, 'ChIJCfqWRoiDOxARYMqFJ1Hem4g/0.jpg', 5, 11, 'University of Education Roundabout, Ojo, Lagos 102103, Nigeria'],
  ['de328cad-0aa2-405d-9a8a-d37dbc4db879', 'Funtasticaland', 'play', 164, true, 'ChIJkfqI2neSOxAR92ROZhEoIi8/0.jpg', 4.3, 1053, '360 Ikorodu Rd, Anthony, Lagos 105102, Nigeria'],

  ['df486b65-ceab-46d9-aeff-d8e62ea35621', 'Johnson Jakande Tinubu (JJT) Park', 'nature', 161.6, true, 'ChIJM1t4mLWTOxARINF1cGhbTKM/0.jpg', 4.3, 5987, 'Beside Lagos State Secretariat, Alausa, Ikeja 100001, Lagos, Nigeria'],
  ['ddaea991-6f96-43dd-a0f6-5f84f4982f71', 'Eric Kayser - Victoria Island', 'icebreakers', 170, true, 'ChIJVUftO7r1OxARUCfrp6T_0jc/0.jpg', 4.5, 4315, '864A Bishop Aboyade Cole St, Victoria Island, Lagos 106104, Nigeria'],
  ['2d253729-f6da-45c2-92a7-d658a140a19e', 'Vetro lounge', 'drinks', 194, true, 'ChIJZUKa0an1OxAReVmwoORx3ts/0.jpg', 4.5, 53, 'Bridgeview Admiralty Way, Lekki Phase I, Lagos 106104, Nigeria'],
  ['95ae8c6c-d1e2-49c2-82c6-0d04ad37f8b3', 'Hot Crust Cafe', 'brunch', 188, true, 'ChIJ6f6Jmu-TOxARRcGrg9tuLyk/0.jpg', 4.6, 61, 'Alpha Mall, 117 Ogudu Rd, Lagos 100242, Nigeria'],
  ['3dc9854d-31dc-485c-95bd-6e15e489387f', 'Debonairs Pizza', 'casual_food', 189, true, 'ChIJ4ULBLkSNOxARenLGAzjpwYI/0.jpg', 4.1, 299, '2 Yesufu Sanusi St, Surulere, Lagos 101241, Nigeria'],
  ['94bdc085-4f47-4556-b4e0-9d3bff478302', 'Elysium Lagos', 'fine_dining', 175.7, true, 'ChIJy2v1P9H1OxARGNWveyrv0DI/0.jpg', 4.4, 184, 'Plot 6, Block 89 Omorinre Johnson St, Lekki Phase 1, Lagos 105102, Nigeria'],
  ['9648e099-019b-4859-8b76-1bd81b9da71f', 'VIVA Cinemas Ikeja', 'movies', 160.6, true, 'ChIJD2fpqSmTOxAREVZwCtfiprA/0.jpg', 4.3, 2023, '22 Simbiat Abiola Way, Ikeja, Lagos 101233, Nigeria'],
  ['ae977e72-261e-4645-8a06-ebf2142580bf', 'The Canyon Lekki Halls & Event Centre', 'theatre', 146, true, 'ChIJz72BGjX1OxARtPYos1wBSkc/0.jpg', 4.3, 118, '14 Kusenla Rd, Ikate Elegushi, Lekki 106104, Lagos, Nigeria'],
  ['0dc1b6ce-a219-46e1-bfed-820eb847f672', 'GRILLOArt LIMITED', 'creative_arts', 178.1, true, 'ChIJbTCIYO6TOxARIm2_Mx5wIT8/0.jpg', 4.9, 10, '28 Ogunlowo St, Ikeja, Lagos 101233, Nigeria'],
  ['bc99d5c2-fb60-4cb6-9952-01469a47dabc', 'Funzia World', 'play', 163.8, true, 'ChIJzyjtDKz1OxARI0is2Q1qaXM/0.jpg', 4.4, 81, '12B Africa Ln, off Admiralty Rd, Lekki Phase 1, Lagos 101233, Nigeria'],
] as const

function placeFromSnapshot(row: PlaceSnapshotRow): CataloguePlace {
  const [placePoolId, name, categorySlug, signalScore, aiBlended, photoPath, rating, reviewCount, address] = row
  const category = EXPLORER_CATEGORIES.find((candidate) => candidate.slug === categorySlug)
  if (!category) throw new Error(`Unknown Explorer category: ${categorySlug}`)
  return {
    kind: 'place',
    placePoolId,
    name,
    categorySlug,
    categoryLabel: category.label,
    signalScore,
    aiBlended,
    photoUrls: [`${PHOTO_BASE}/${photoPath}`],
    rating,
    reviewCount,
    oneLiner: null,
    address,
    scoredAt: SCORE_TIMESTAMPS[categorySlug],
    sourceUpdatedAt: SOURCE_UPDATED_AT,
    detailHref: `${CITY_PATH}?type=places&detail=place:${placePoolId}`,
  }
}

export function getLagosRankedPlaces(): readonly CataloguePlace[] {
  const rows = LAGOS_PLACE_SNAPSHOT.map(placeFromSnapshot)
  if (rows.length !== 50 || new Set(rows.map((row) => row.placePoolId)).size !== 50) {
    throw new Error('The Lagos review snapshot must contain exactly 50 unique places')
  }
  for (const category of EXPLORER_CATEGORIES) {
    if (rows.filter((row) => row.categorySlug === category.slug).length !== 5) {
      throw new Error(`The Lagos review snapshot must contain five ${category.label} places`)
    }
  }
  return rows
}

export function getLagosCuratedPlans(): readonly CataloguePlan[] {
  const placesByName = new Map(getLagosRankedPlaces().map((place) => [place.name, place]))
  return LAGOS_INTENT_PLANS.map((plan) => ({
    kind: 'plan' as const,
    generatedCardId: `lagos-editorial-${plan.id}`,
    title: plan.intentTitle,
    intentLabel: plan.id.replaceAll('-', ' '),
    sellLine: plan.sellLine,
    itineraryLabel: plan.itineraryLabel,
    photoUrls: plan.stops.map((stop) => stop.heroPhoto).filter(Boolean),
    stops: plan.stops.map((stop, index) => ({
      id: `lagos-editorial-${plan.id}-${index + 1}`,
      name: stop.name,
      role: stop.role,
      photoUrl: stop.heroPhoto,
      address: placesByName.get(stop.name)?.address ?? null,
    })),
    duration: null,
    price: null,
    generatedAt: '2026-09-02',
    detailHref: `${CITY_PATH}?type=plans&detail=plan:lagos-editorial-${plan.id}`,
  }))
}

export function getLagosCatalogueSnapshot(): {
  readonly places: readonly CataloguePlace[]
  readonly plans: readonly CataloguePlan[]
} {
  return { places: getLagosRankedPlaces(), plans: getLagosCuratedPlans() }
}
