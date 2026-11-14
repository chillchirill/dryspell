import {describe,it,expect} from 'vitest';
import type {WeatherSnapshot} from '@dryspell/contracts';
import {weatherExtension} from './weather';
describe('forecast extension disclosure',()=>{const weather={provenance:[{parameters:{extensionPolicy:'hold-last-conditions',forecastEndSec:3600,extensionEndSec:360000}}]} as unknown as WeatherSnapshot;it('discloses the exact bounded assumption beyond real forecast',()=>expect(weatherExtension(weather,360000)).toEqual({forecastEndSec:3600,extensionEndSec:360000}));it('does not label covered short experiments as extended',()=>expect(weatherExtension(weather,1800)).toBeNull());it('does not invent extension metadata',()=>expect(weatherExtension({provenance:[]} as unknown as WeatherSnapshot,100000)).toBeNull());});
