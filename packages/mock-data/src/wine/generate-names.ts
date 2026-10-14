// cspell:disable -- invented producer names and designation terms in eight languages
/**
 * Winery and designation naming for the synthetic wine generator (`./generate.ts`).
 *
 * @remarks
 * Every winery name here is **invented**: common given names, surnames and landscape words set in a
 * naming pattern of the producing country's language ("Domaine Garnier", "Bodegas Navarro", "Weingut
 * Hartmann", "Cedar Hollow"). None is taken from any dataset. Any resemblance to a real producer is
 * the coincidence that common surnames make inevitable.
 *
 * A winery is identified by its country and an index into that country's producer pool.
 * {@link wineryName} maps the pair to a name without storing one, so the full tier's tens of
 * thousands of producers cost nothing until a record asks for one.
 *
 * Designations mix the style terms the trade uses ("Reserva", "Brut", "Vieilles Vignes"), picked per
 * country and color, with invented vineyard names.
 *
 * @packageDocumentation
 */

import type { WineColor } from './types.js';

import { pickOne, type SeededRng } from '../_generation/random.js';

/** A naming tradition: who the producers are and how their names are written. */
interface NamingTradition {
	/** Patterns for a vineyard designation; `{name}` is a surname or landscape word. */
	readonly designationPatterns: readonly string[];
	/** Given names, for producers named after a person. */
	readonly firstNames: readonly string[];
	/** Landscape words for place-style names. */
	readonly places: readonly string[];
	/** Style designations in this tradition, for still wines. */
	readonly styleDesignations: readonly string[];
	/** Surnames, or the family part of a producer name. */
	readonly surnames: readonly string[];
	/**
	 * Winery patterns. `{first}`, `{surname}`, `{surname2}` and `{place}` are filled from this
	 * tradition's lists; each pattern contributes one name per combination of the lists it uses.
	 */
	readonly wineryPatterns: readonly string[];
}

/** English-language producers: the United States, Australia, New Zealand, South Africa and others. */
const ENGLISH: NamingTradition = {
	designationPatterns: ['{name} Vineyard', '{name} Ranch', '{name} Block', '{name} Hill', '{name} Vineyards', 'Estate {name}'],
	firstNames: ['Anna', 'Ben', 'Clara', 'Daniel', 'Eli', 'Grace', 'Henry', 'Jack', 'Lucy', 'Max', 'Nora', 'Owen', 'Ruth', 'Sam', 'Tess'],
	places: ['Alder', 'Aspen', 'Bluff', 'Briar', 'Cedar', 'Copper', 'Coyote', 'Crane', 'Eagle', 'Elk', 'Falcon', 'Fern', 'Fox', 'Granite', 'Hawk', 'Heron', 'Juniper', 'Lark', 'Laurel', 'Maple', 'Meadow', 'Mesa', 'Oak', 'Owl', 'Pine', 'Quail', 'Raven', 'Redwood', 'Sage', 'Silver', 'Sparrow', 'Stone', 'Sycamore', 'Thistle', 'Walnut', 'Willow', 'Wolf', 'Wren'],
	styleDesignations: ['Reserve', 'Estate', 'Estate Grown', 'Estate Bottled', 'Old Vine', 'Single Vineyard', 'Barrel Select', 'Private Reserve', 'Unoaked', 'Barrel Fermented', 'Signature', 'Limited Release', "Winemaker's Reserve", 'Family Reserve', 'Dry', 'Proprietary Red', 'Classic', 'Heritage', 'Estate Reserve', 'Grand Reserve'],
	surnames: ['Aldridge', 'Ashford', 'Barlow', 'Beaumont', 'Bennett', 'Blackwell', 'Bradford', 'Calloway', 'Carver', 'Chandler', 'Coleman', 'Crawford', 'Dalton', 'Delaney', 'Donovan', 'Ellison', 'Fairbanks', 'Fletcher', 'Garrison', 'Greenwood', 'Halstead', 'Hargrove', 'Hartmann', 'Hawthorne', 'Holloway', 'Iversen', 'Jameson', 'Kellerman', 'Kingsley', 'Langford', 'Larkspur', 'Lockhart', 'Maddox', 'Mercer', 'Merriweather', 'Montague', 'Nightingale', 'Oakhurst', 'Pemberton', 'Prescott', 'Quinlan', 'Ravenscroft', 'Remington', 'Rutledge', 'Sinclair', 'Stanton', 'Sutherland', 'Tarrington', 'Thornton', 'Vandermark', 'Wakefield', 'Westmoreland', 'Whitfield', 'Winslow', 'Yardley'],
	wineryPatterns: ['{surname} Cellars', '{surname} Vineyards', '{surname} Estate', '{surname} Winery', '{surname} Family Wines', '{place} Ridge', '{place} Creek', '{place} Hollow', '{place} Hill', '{place} Canyon', '{surname} & {surname2}', '{surname} {place} Vineyards', '{first} {surname} Wines', '{place} & {surname}'],
};

/** French-language producers: France, Switzerland, Luxembourg, Lebanon and Morocco. */
const FRENCH: NamingTradition = {
	designationPatterns: ['Clos {name}', 'Les {name}', 'Cuvée {name}', 'Le Clos des {name}', 'Lieu-dit {name}'],
	firstNames: ['Alain', 'Anne', 'Bernard', 'Claire', 'Denis', 'Élise', 'François', 'Hélène', 'Jacques', 'Louis', 'Marie', 'Paul', 'Pierre', 'Sophie'],
	places: ['Aubépines', 'Bruyères', 'Cailloux', 'Châtaigniers', 'Chênes', 'Collines', 'Coteaux', 'Galets', 'Genêts', 'Grillons', 'Hirondelles', 'Lauriers', 'Mésanges', 'Noyers', 'Peupliers', 'Pierres', 'Pins', 'Roches', 'Saules', 'Sources', 'Terrasses', 'Tilleuls', 'Tourelles', 'Vignes'],
	styleDesignations: ['Vieilles Vignes', 'Réserve', 'Tradition', 'Cuvée Prestige', 'Grand Vin', 'Premier Cru', 'Grand Cru', 'Cuvée Spéciale', 'Sélection', 'Grande Réserve', 'Élevé en Fût de Chêne', 'Les Terroirs'],
	surnames: ['Arnaud', 'Barbier', 'Bertin', 'Blanchet', 'Boucher', 'Brunel', 'Castel', 'Chauvet', 'Colin', 'Courtois', 'Delorme', 'Devereaux', 'Duval', 'Fabre', 'Fontaine', 'Garnier', 'Gauthier', 'Gilbert', 'Guichard', 'Hébert', 'Jourdan', 'Lacroix', 'Lambert', 'Langlois', 'Lemaire', 'Marchand', 'Mercier', 'Moulin', 'Noël', 'Olivier', 'Pelletier', 'Perrot', 'Poirier', 'Renaud', 'Rivière', 'Roche', 'Sauvage', 'Tessier', 'Vasseur', 'Vidal', 'Aubert', 'Bonnet', 'Carré', 'Dufour', 'Lefort', 'Masson', 'Pages', 'Royer', 'Thibault', 'Vallet'],
	wineryPatterns: ['Domaine {surname}', 'Château {place}', 'Maison {surname}', 'Domaine des {place}', 'Clos des {place}', '{surname} Père et Fils', 'Domaine {surname}-{surname2}', 'Château {surname}-{surname2}', 'Domaine {first} {surname}', 'Domaine {surname} des {place}'],
};

/** Italian producers. */
const ITALIAN: NamingTradition = {
	designationPatterns: ['Vigna {name}', 'Vigneto {name}', 'Bricco {name}', 'Podere {name}', 'Cru {name}'],
	firstNames: ['Alberto', 'Bruno', 'Carla', 'Elena', 'Franco', 'Giulia', 'Giuseppe', 'Lorenzo', 'Lucia', 'Marco', 'Paolo', 'Sara', 'Silvio', 'Teresa'],
	places: ['Belvedere', 'Boschetto', 'Castagneto', 'Cerreto', 'Colombaia', 'Fontanile', 'Gelso', 'Ginestra', 'Lecceto', 'Mandorlo', 'Melograno', 'Noceto', 'Olmo', 'Pietraia', 'Pineta', 'Poggiolo', 'Querceto', 'Ripa', 'Roccolo', 'Sassello', 'Tiglio', 'Uliveto', 'Valletta', 'Vigneto'],
	styleDesignations: ['Riserva', 'Classico', 'Superiore', 'Rosso', 'Bianco', 'Classico Riserva', 'Selezione', 'Vecchie Viti'],
	surnames: ['Amato', 'Barone', 'Bellini', 'Benedetti', 'Bianchi', 'Caruso', 'Castellini', 'Colombo', 'Conti', 'Costa', 'De Luca', 'Esposito', 'Fabbri', 'Ferrara', 'Fontana', 'Galli', 'Gentile', 'Greco', 'Leone', 'Lombardi', 'Mancini', 'Marchetti', 'Marini', 'Martini', 'Messina', 'Monti', 'Morelli', 'Orlando', 'Pellegrini', 'Rinaldi', 'Romano', 'Rossetti', 'Russo', 'Santoro', 'Serra', 'Testa', 'Valentini', 'Villa', 'Vitale', 'Zanetti'],
	wineryPatterns: ['Tenuta {place}', 'Cantina {surname}', 'Fattoria {place}', 'Podere {place}', 'Castello di {place}', 'Fratelli {surname}', 'Azienda Agricola {first} {surname}', 'Cantina {first} {surname}', 'Tenuta {place} di {surname}', '{surname} {surname2}', 'Cantine {surname}-{surname2}'],
};

/** Spanish-language producers: Spain, Argentina, Chile, Uruguay, Mexico and Peru. */
const SPANISH: NamingTradition = {
	designationPatterns: ['Finca {name}', 'Pago {name}', 'Viña {name}', 'Parcela {name}', 'El {name}'],
	firstNames: ['Alejandro', 'Ana', 'Carlos', 'Carmen', 'Diego', 'Elena', 'Javier', 'Lucía', 'Manuel', 'Pablo', 'Pilar', 'Rosa', 'Tomás'],
	places: ['Alamos', 'Algarrobo', 'Arroyo', 'Cardón', 'Cerro', 'Colibrí', 'Cóndor', 'Encina', 'Espino', 'Halcón', 'Higuera', 'Jarilla', 'Laguna', 'Llano', 'Loma', 'Molle', 'Nogal', 'Olivar', 'Peñasco', 'Piedra', 'Quebrada', 'Retamo', 'Sauce', 'Tordo'],
	styleDesignations: ['Reserva', 'Crianza', 'Gran Reserva', 'Roble', 'Joven', 'Selección', 'Tinto', 'Blanco', 'Gran Reserva Especial', 'Reserva de Familia'],
	surnames: ['Acosta', 'Aguirre', 'Alvarado', 'Arrieta', 'Benítez', 'Cabrera', 'Calderón', 'Campos', 'Castro', 'Cordero', 'Domínguez', 'Echeverría', 'Espinoza', 'Fuentes', 'Gallardo', 'Guerrero', 'Ibarra', 'Lozano', 'Maldonado', 'Medina', 'Molina', 'Montero', 'Navarro', 'Ochoa', 'Ortega', 'Pacheco', 'Paredes', 'Quinones', 'Ramos', 'Rojas', 'Salazar', 'Serrano', 'Soto', 'Valdés', 'Vasquez', 'Vega', 'Villalobos', 'Zamora'],
	wineryPatterns: ['Bodegas {surname}', 'Viña {place}', 'Finca {place}', 'Bodega {surname}', 'Hacienda {place}', 'Familia {surname}', 'Bodegas {surname} {surname2}', 'Viñedos {first} {surname}', 'Finca {place} de {surname}'],
};

/** Portuguese-language producers: Portugal and Brazil. */
const PORTUGUESE: NamingTradition = {
	designationPatterns: ['Vinha {name}', 'Quinta {name}', 'Lote {name}', 'Encosta {name}'],
	firstNames: ['António', 'Beatriz', 'Francisco', 'Inês', 'João', 'Luísa', 'Manuel', 'Miguel', 'Rita', 'Rui'],
	places: ['Azinheira', 'Carvalhal', 'Castanheiro', 'Cerejeira', 'Fonte', 'Freixo', 'Lagar', 'Loureiro', 'Moinho', 'Oliveira', 'Outeiro', 'Pedra', 'Pinhal', 'Ribeira', 'Sobreiro', 'Souto', 'Vale', 'Videira'],
	styleDesignations: ['Reserva', 'Grande Reserva', 'Colheita', 'Tinto', 'Branco', 'Vinhas Velhas', 'Garrafeira'],
	surnames: ['Almeida', 'Amaral', 'Barbosa', 'Cardoso', 'Carvalho', 'Correia', 'Cunha', 'Duarte', 'Esteves', 'Faria', 'Fernandes', 'Figueiredo', 'Lopes', 'Macedo', 'Magalhães', 'Matos', 'Mendes', 'Moreira', 'Nogueira', 'Pinheiro', 'Queirós', 'Rebelo', 'Sampaio', 'Tavares', 'Teixeira', 'Valente'],
	wineryPatterns: ['Quinta do {place}', 'Quinta da {place}', 'Herdade do {place}', 'Casa {surname}', 'Adega {surname}', '{first} {surname} Vinhos', 'Quinta {surname} {surname2}'],
};

/** German-language producers: Germany and Austria. */
const GERMAN: NamingTradition = {
	designationPatterns: ['{name}berg', '{name}garten', '{name} Ried', 'Lage {name}'],
	firstNames: ['Anna', 'Christian', 'Eva', 'Franz', 'Hans', 'Johann', 'Julia', 'Karl', 'Lena', 'Markus', 'Peter', 'Sabine'],
	places: ['Ahorn', 'Birken', 'Buchen', 'Eichen', 'Falken', 'Felsen', 'Finken', 'Hasen', 'Kiesel', 'Lerchen', 'Linden', 'Mühlen', 'Rosen', 'Schiefer', 'Sonnen', 'Stein', 'Tannen', 'Wald'],
	styleDesignations: ['Trocken', 'Kabinett', 'Spätlese', 'Auslese', 'Feinherb', 'Smaragd', 'Federspiel', 'Reserve', 'Alte Reben', 'Halbtrocken'],
	surnames: ['Albrecht', 'Bauer', 'Becker', 'Brandt', 'Engel', 'Fischer', 'Franke', 'Gruber', 'Hartmann', 'Hofer', 'Huber', 'Jung', 'Kellerman', 'Klein', 'Koch', 'Krause', 'Lang', 'Lorenz', 'Maurer', 'Möller', 'Neumann', 'Pichler', 'Reiter', 'Roth', 'Schreiber', 'Seidl', 'Vogel', 'Weber', 'Winkler', 'Zimmermann'],
	wineryPatterns: ['Weingut {surname}', 'Weingut {place}hof', 'Weinhof {surname}', 'Weingut {first} {surname}', 'Weingut {surname}-{surname2}'],
};

/** Greek producers: Greece and Cyprus. */
const GREEK: NamingTradition = {
	designationPatterns: ['{name} Vineyard', 'Ktima {name}', '{name} Slopes'],
	firstNames: ['Alexandros', 'Eleni', 'Giorgos', 'Maria', 'Nikos', 'Sofia', 'Yannis'],
	places: ['Akti', 'Ampelos', 'Dafni', 'Elia', 'Kastro', 'Kipos', 'Lofos', 'Melissa', 'Petra', 'Plátanos', 'Rodia', 'Vrysi'],
	styleDesignations: ['Reserve', 'Grande Reserve', 'Old Vines', 'Barrel Aged'],
	surnames: ['Alexiou', 'Andreou', 'Antoniou', 'Christou', 'Dimitriou', 'Georgiou', 'Ioannou', 'Kalogirou', 'Konstantinou', 'Lazarou', 'Makris', 'Nikolaou', 'Panagiotou', 'Papadakis', 'Petrou', 'Stavrou', 'Vasileiou', 'Zervas'],
	wineryPatterns: ['Ktima {surname}', 'Domaine {surname}', '{surname} Winery', 'Ktima {place}', '{first} {surname} Estate'],
};

/** Central and Eastern European, Caucasian and other producers. */
const CENTRAL_EUROPEAN: NamingTradition = {
	designationPatterns: ['{name} Vineyard', '{name} Hill', 'Selection {name}'],
	firstNames: ['Ana', 'Andrei', 'Ivan', 'Jana', 'Marko', 'Nikola', 'Petra', 'Tamás', 'Zoltán'],
	places: ['Bela', 'Breza', 'Dub', 'Gora', 'Hrast', 'Jabuka', 'Kamen', 'Lipa', 'Polje', 'Reka', 'Sokol', 'Vrh'],
	styleDesignations: ['Reserve', 'Selection', 'Barrique', 'Premium', 'Late Harvest', 'Classic'],
	surnames: ['Babić', 'Balogh', 'Dimitrov', 'Horvat', 'Ionescu', 'Ivanov', 'Kovács', 'Kovač', 'Krajnc', 'Marković', 'Molnár', 'Nagy', 'Novak', 'Petrov', 'Popescu', 'Radu', 'Stoica', 'Szabó', 'Tóth', 'Varga', 'Zelenko'],
	wineryPatterns: ['{surname} Winery', 'Vinarija {surname}', '{surname} Cellars', '{place} Estate', '{first} {surname} Wines'],
};

/**
 * Which naming tradition each producing country writes in. Countries not listed use
 * {@link CENTRAL_EUROPEAN}'s neutral patterns.
 */
const TRADITION_BY_COUNTRY: Readonly<Record<string, NamingTradition>> = {
	Argentina: SPANISH,
	Australia: ENGLISH,
	Austria: GERMAN,
	Brazil: PORTUGUESE,
	Canada: ENGLISH,
	Chile: SPANISH,
	China: ENGLISH,
	Cyprus: GREEK,
	England: ENGLISH,
	France: FRENCH,
	Germany: GERMAN,
	Greece: GREEK,
	India: ENGLISH,
	Israel: ENGLISH,
	Italy: ITALIAN,
	Lebanon: FRENCH,
	Luxembourg: FRENCH,
	Mexico: SPANISH,
	Morocco: FRENCH,
	'New Zealand': ENGLISH,
	Peru: SPANISH,
	Portugal: PORTUGUESE,
	'South Africa': ENGLISH,
	Spain: SPANISH,
	Switzerland: FRENCH,
	Uruguay: SPANISH,
	US: ENGLISH,
};

/**
 * The naming tradition a country's producers use.
 *
 * @param country - Country name as it appears in the origin table.
 * @returns That country's tradition, or the neutral one.
 */
function traditionFor(country: string): NamingTradition {
	return TRADITION_BY_COUNTRY[country] ?? CENTRAL_EUROPEAN;
}

/** The lists a winery pattern draws from, in the order its combination index is decoded. */
const PLACEHOLDER_LISTS = ['{first}', '{surname}', '{surname2}', '{place}'] as const;

/** One of the four placeholders a winery pattern can use. */
type Placeholder = (typeof PLACEHOLDER_LISTS)[number];

/**
 * The list a placeholder is filled from.
 *
 * @param tradition - The naming tradition.
 * @param placeholder - The placeholder.
 * @returns The candidate words.
 */
function wordsFor(tradition: NamingTradition, placeholder: Placeholder): readonly string[] {
	if (placeholder === '{first}') {
		return tradition.firstNames;
	}
	if (placeholder === '{place}') {
		return tradition.places;
	}

	return tradition.surnames;
}

/**
 * How many distinct names a pattern can produce: the product of the sizes of the lists it uses.
 *
 * @param tradition - The naming tradition.
 * @param pattern - One of its winery patterns.
 * @returns The pattern's capacity.
 */
function patternCapacity(tradition: NamingTradition, pattern: string): number {
	let capacity = 1;

	for (const placeholder of PLACEHOLDER_LISTS) {
		if (pattern.includes(placeholder)) {
			capacity *= wordsFor(tradition, placeholder).length;
		}
	}

	return capacity;
}

/** Per-tradition pattern capacities, computed once per tradition on first use. */
const CAPACITIES_BY_TRADITION = new Map<NamingTradition, readonly number[]>();

/**
 * Multiplier that scatters consecutive pool indices across the name space, so the most-reviewed
 * producers (the lowest indices) do not all share one pattern. A prime, so multiplying by it is a
 * bijection modulo any capacity it does not divide, which no capacity here does.
 */
const NAME_SCATTER_MULTIPLIER = 7919;

/**
 * Where a country's producer pool starts in its tradition's name space: an FNV-1a hash of the
 * country name. Without it, every English-speaking country's best-known producer would share one
 * name.
 *
 * @param country - Producing country.
 * @returns A non-negative 32-bit offset.
 */
function countryNameOffset(country: string): number {
	let hash = 0x811C9DC5;

	for (let position = 0; position < country.length; position++) {
		hash = Math.imul(hash ^ country.charCodeAt(position), 0x01000193);
	}

	return hash >>> 0;
}

/**
 * The name of winery `index` in `country`'s producer pool.
 *
 * @remarks
 * Deterministic and storage-free. The tradition's patterns jointly offer a fixed number of
 * distinct names (each pattern one per combination of the word lists it uses); the index is
 * offset per country, scattered across that space and decoded into a pattern plus one word per
 * placeholder. Within one country, distinct indices below the tradition's capacity give distinct
 * names; beyond it, names repeat.
 *
 * @param country - Producing country.
 * @param index - Pool index, from 0.
 * @returns An invented producer name.
 */
export function wineryName(country: string, index: number): string {
	const tradition = traditionFor(country);
	let capacities = CAPACITIES_BY_TRADITION.get(tradition);

	if (capacities === undefined) {
		capacities = tradition.wineryPatterns.map((pattern) => patternCapacity(tradition, pattern));
		CAPACITIES_BY_TRADITION.set(tradition, capacities);
	}

	const total = capacities.reduce((sum, capacity) => sum + capacity, 0);
	let remaining = ((index + countryNameOffset(country)) * NAME_SCATTER_MULTIPLIER) % total;
	let patternIndex = 0;

	while (remaining >= (capacities[patternIndex] ?? total)) {
		remaining -= capacities[patternIndex] ?? total;
		patternIndex += 1;
	}

	let name = tradition.wineryPatterns[patternIndex] ?? '';

	for (const placeholder of PLACEHOLDER_LISTS) {
		if (name.includes(placeholder)) {
			const words = wordsFor(tradition, placeholder);

			name = name.replace(placeholder, words[remaining % words.length] ?? '');
			remaining = Math.floor(remaining / words.length);
		}
	}

	return name;
}

/** Style designations for sparkling wines, whatever the country. */
const SPARKLING_DESIGNATIONS: readonly string[] = ['Brut', 'Extra Brut', 'Brut Rosé', 'Blanc de Blancs', 'Blanc de Noirs', 'Extra Dry', 'Brut Réserve', 'Brut Nature', 'Cuvée Brut'];

/** Style designations for fortified wines. */
const FORTIFIED_DESIGNATIONS: readonly string[] = ['Tawny', '10 Year Old Tawny', '20 Year Old Tawny', 'Late Bottled Vintage', 'Ruby', 'Reserve', 'Fino', 'Oloroso', 'Amontillado'];

/** Style designations for dessert wines. */
const DESSERT_DESIGNATIONS: readonly string[] = ['Late Harvest', 'Ice Wine', 'Noble', 'Botrytis Selection', 'Passito', 'Vendanges Tardives'];

/** Share of designated wines whose designation is a style term rather than a vineyard name. */
const STYLE_DESIGNATION_SHARE = 0.35;

/** Share of vineyard designations named after a family rather than a landscape word. */
const FAMILY_VINEYARD_SHARE = 0.5;

/**
 * A designation for a wine that has one: a style term fitting its country and color, or an
 * invented vineyard name in the country's language.
 *
 * @param rng - Seeded random source of the record being generated.
 * @param country - Producing country.
 * @param color - The wine's color; sparkling, fortified and dessert wines use their own style terms.
 * @returns A non-empty designation.
 */
export function designationFor(rng: SeededRng, country: string, color: WineColor): string {
	const tradition = traditionFor(country);

	if (rng() < STYLE_DESIGNATION_SHARE) {
		if (color === 'sparkling') {
			return pickOne(rng, SPARKLING_DESIGNATIONS);
		}
		if (color === 'fortified') {
			return pickOne(rng, FORTIFIED_DESIGNATIONS);
		}
		if (color === 'dessert') {
			return pickOne(rng, DESSERT_DESIGNATIONS);
		}

		return pickOne(rng, tradition.styleDesignations);
	}

	const name = rng() < FAMILY_VINEYARD_SHARE ? pickOne(rng, tradition.surnames) : pickOne(rng, tradition.places);

	return pickOne(rng, tradition.designationPatterns).replace('{name}', name);
}
