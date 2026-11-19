// Italic scientific names in already-escaped HTML text: "Pratylenchus coffeae", "Aphis spp.", "banana
// xanthomonas wilt". The genera are those found in the trait dictionaries, spelled as they are there (including
// misspellings such as "Colletotricum"), since names can't be told from ordinary words reliably otherwise. A genus
// is italic with its species epithet (a following word with a Latin ending, or sp./spp.) or on its own, except
// for genera that are also crop or English words, which need an epithet.

const GENERA = `Acanthocelides Acremonium Acrythosiphon Aeneolamia Agonoscelis Albugo Alcidodes Alectra Aleurodicus
Aleurotrachelus Alternaria Anguina Aphanomyces Aphis Arachis Araecerus Ascochyta Aspergillus Atherigona Balansia
Bemesia Bemisia Bipolaris Blaniulus Blumeria Bothynus Botrytis Brassica Bruchidius Callosobruchus Calonectria Caryedon
Cephalosporium Cephus Cercospora Ceutorhynchus Chalara Chilo Clavibacter Clavigralla Cnaphalocrosis Cochliobolus
Cochylis Colletothrichum Colletotrichum Colletotricum Coniesta Contarinia Coroebus Corticum Corynespora Cremastogaster
Curvularia Cylindrocopturus Dectes Dendrocopus Diaporthe Didymella Diopsis Diplocarpon Ditylenchus Diuraphis Drechslera
Dreschlera Empoasca Ephelis Erwina Erwinia Erysiphe Etiella Eurygaster Exserohilum Franklinella Fusarium
Gaeumannomyces Gibberella Grapholita Helianthus Helicobasidium Helicotylenchus Helicotylincus Helicoverpa Heliothis
Helminthosporium Heterodera Homoeosoma Hoplolaimus Hydrellia Hypera Ilex Isariopsis Lens Leptocorisa Leptosphaeria
Liriomyza Lygus Macrophomina Magnaporthe Maliarpha Marasmia Maruca Mayetiola Maytiola Mecas Melanagromyza Meliodogyne
Meloidogyne Microdochium Microphomina Monographella Mononychellus Mycosphaerella Mycovellosiella Myzus Nakatea
Neopestalotiopsis Neovossia Nephotettix Nilparvata Nothopassalora Nymphula Oligonychus Onobrychis Ophiomyia Orobanche
Orseolia Oulema Passalora Pectinophora Pegomyia Penicillium Pennisetum Peronosclerospora Peronospora Phaeoisariopsis
Phaeoramularia Phaeosphaeria Phemphigus Phialophora Phoma Phomopsis Phyllachora Phyllosticta Physoderma Physopella
Phytium Phytophthora Plasmopara Podosphaera Polymyxa Practylenchus Pratylenchus Prosapia Prostephanus Protapion
Pseudocercosporella Pseudomonas Puccinia Pyrenophora Pyricularia Pythium Radopholus Ramularia Ramulispora Rhizobium
Rhizoctonia Rhizopus Rhopalosiphum Rhynchosporium Rhyncosporium Rotylenchulus Rotylenchus Rupela Scaphytopius
Schizaphis Sclerophthora Sclerotinia Sclerotium Septoria Sesamia Sitona Sitophilus Smicronyx Smycronyx Sogatella
Sogatodes Soracladium Sorghum Sphacelotheca Sphaerotheca Sphaerulina Spodoptera Stagonospora Stemphylium
Stenchaetothrips Strauzia Striga Suleima Tagosodes Tanaostigmodes Tapesia Tetanops Tetranychus Thanatephorus
Thanethoporus Thekopsora Tilletia Urocystic Uromyces Ustilaginoidea Ustilago Vaccinium Verticilium Verticillium Vinca
Xanthomonas Zabrotes Zulia Zygogramma`.split(/\s+/);

// Genera that are also crop or English words: italic only with an epithet ("Sorghum bicolor", not "Sorghum").
const NEEDS_EPITHET = new Set(['brassica', 'lens', 'sorghum']);
const EPITHET = /^[a-z]+(?:us|um|a|ae|i|is|ensis|oides|orum|arum|ix|ax|ex|or|ens|ans)$/;
const NOT_EPITHET = new Set(['area', 'data', 'plus', 'via', 'versus', 'analysis', 'basis', 'status', 'axis', 'color',
  'colour', 'flavor', 'odor', 'vigor', 'factor', 'sector', 'for', 'or', 'is', 'as', 'a', 'i', 'ii', 'this', 'thus',
  'index', 'maximum', 'minimum', 'medium', 'optimum', 'spectrum', 'premium', 'serum', 'stadium']);
const NAME = new RegExp(`\\b(${GENERA.join('|')})\\b(?:(\\s+)(spp?\\.|[a-z]+))?`, 'gi');

export function italicizeSpecies(html) {
  return String(html).replace(NAME, (match, genus, space, word) => {
    // "Striga" or "striga", but not an abbreviation such as "STRIGA" or "AphIS".
    if (genus !== genus.toLowerCase() && genus !== genus[0] + genus.slice(1).toLowerCase()) return match;
    const epithet = word && (/^spp?\.$/.test(word) || (EPITHET.test(word) && !NOT_EPITHET.has(word))) ? space + word : '';
    if (!epithet && NEEDS_EPITHET.has(genus.toLowerCase())) return match;
    return `<i>${genus}${epithet}</i>${match.slice(genus.length + epithet.length)}`;
  });
}
