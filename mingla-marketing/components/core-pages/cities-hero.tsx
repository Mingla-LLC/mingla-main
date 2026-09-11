import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown } from 'lucide-react'
import { CITY_HUBS, cityHubPath } from '@/content/cities/registry'

export function CitiesHero() {
  return (
    <section className="core-cities-hero relative flex min-h-[100svh] items-center justify-center overflow-hidden" aria-labelledby="cities-title">
      <Image
        src="/marketing/cities/cities-hero.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="core-cities-hero-image object-cover"
      />
      <div className="core-cities-hero-scrim" aria-hidden="true" />
      <div className="core-cities-hero-content relative z-10 mx-auto flex flex-col items-center text-center">
        <h1 id="cities-title">Explore Mingla city by city.</h1>
        <p>Pick a city to discover its top-ranked places and turn what sounds good into a plan. Run a venue, event, trip or experience there? Mingla Host helps you publish and promote it.</p>
        <nav aria-label="Choose a Mingla city" className="core-city-pills">
          <ul>
            {CITY_HUBS.map((city) => (
              <li key={city.slug}>
                <Link href={cityHubPath(city)} data-city-pill={city.slug}>
                  {city.city}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <a href="#directory" className="core-cities-scroll focus-ring">
        Choose your city
        <ArrowDown aria-hidden="true" size={17} />
      </a>
    </section>
  )
}
