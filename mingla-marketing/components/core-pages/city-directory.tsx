import Link from 'next/link'
import { CITY_HUBS, cityHubEffectiveLifecycle, cityHubPath, isCityHubSearchReady } from '@/content/cities/registry'

export function CityDirectory() {
  return (
    <ul className="core-city-directory" id="choose-a-city">
      {CITY_HUBS.map((city) => {
        const ready = isCityHubSearchReady(city)
        const state = cityHubEffectiveLifecycle(city)
        return (
          <li key={city.slug}>
            <div>
              <span>{ready ? 'Ready' : state === 'stale' ? 'Updating' : 'In review'}</span>
              <h3>{city.city}</h3>
              <p>{city.country}</p>
            </div>
            <p>{city.scopeLabel}</p>
            {ready ? <Link href={cityHubPath(city)}>Explore {city.city}</Link> : <span>Local review in progress</span>}
          </li>
        )
      })}
    </ul>
  )
}
