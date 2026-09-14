import Image from 'next/image'
import Link from 'next/link'
import { CITY_HUBS, cityHubPath } from '@/content/cities/registry'

const CITY_CARD_IMAGES = {
  lagos: 'lagos.jpg',
  'durham-nc': 'durham-nc.jpg',
  'cary-nc': 'cary-nc.jpg',
  'raleigh-nc': 'raleigh-nc.jpg',
  'new-york-city': 'new-york-city.jpg',
  brussels: 'brussels.jpg',
  paris: 'paris.jpg',
  london: 'london.jpg',
  'fort-lauderdale': 'fort-lauderdale.jpg',
  'washington-dc': 'washington-dc.jpg',
} as const

export function CityDirectory() {
  return (
    <ul className="core-city-directory" id="choose-a-city">
      {CITY_HUBS.map((city) => (
        <li key={city.slug}>
          <Link href={cityHubPath(city)} data-city-card={city.slug} aria-label={`Explore ${city.city}`}>
            <Image
              src={`/marketing/cities/cards/${CITY_CARD_IMAGES[city.slug]}`}
              alt=""
              fill
              sizes="(min-width: 1024px) 20vw, (min-width: 520px) 50vw, 100vw"
            />
            <span>{city.city}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
