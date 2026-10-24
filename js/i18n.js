// German / English UI strings. Content strings from data files may be plain strings or {de, en} objects (pick()).
const STR = {
  de: {
    app_title: 'ZeMA Digitaler Zwilling', app_sub: 'Halle begehen und entdecken', loading: 'Lade …', start: 'Start',
    load_manifest: 'Szenenbeschreibung', load_collider: 'Kollisionsmodell', load_hall: 'Hallenmodell',
    load_hall_hi: 'Hallenmodell (Detail)', load_robot: 'Roboter', load_stations: 'Stationen', ready: 'Bereit',
    click_to_start: 'Klicken zum Starten', stations: 'Stationen', stations_hint: 'Klicken, um dorthin zu teleportieren',
    pano_mode: 'Panorama-Modus (P)', proj_tex: 'Foto-Textur (T)', map: 'Karte (M)', settings: 'Einstellungen',
    help: 'Steuerung', language: 'Sprache', quality: 'Qualität', q_low: 'Niedrig', q_medium: 'Mittel', q_high: 'Hoch',
    sensitivity: 'Mausempfindlichkeit', fov: 'Sichtfeld', invert_y: 'Maus-Y-Achse invertieren', show_fps: 'FPS anzeigen',
    debug_view: 'Debug-Ansicht', dbg_weights: 'Pano-Gewichte', dbg_coverage: 'Abdeckung', dbg_baked: 'nur Basistextur',
    pano_opacity: 'Deckkraft', exit: 'Verlassen', reset_progress: 'Fortschritt zurücksetzen',
    discovered: 'Entdeckt', press_e: 'E / Tippen: Info', near: 'In der Nähe', no_panos: 'Keine Panoramen verfügbar',
    map_hint: 'Klick auf eine Station: Teleport · M: schließen', help_touch: 'Touch: linker Daumen bewegen, rechts wischen zum Umsehen.',
    mode_pano: 'Panorama', mode_fly: 'Freiflug', fly_on: 'Freiflug an (keine Kollision)', fly_off: 'Freiflug aus',
    proj_on: 'Foto-Textur an', proj_off: 'Foto-Textur aus', all_found: 'Alle Orte entdeckt!', respawn: 'Zurückgesetzt',
    k_move: 'Bewegen', k_look: 'Umsehen (Klick = Maus fangen)', k_run: 'Rennen', k_jump: 'Springen', k_info: 'Info öffnen',
    k_map: 'Karte', k_pano: 'Panorama-Modus', k_panocycle: 'Panorama wechseln', k_proj: 'Foto-Textur an/aus',
    k_fly: 'Freiflug (Debug)', k_stations: 'Stationsliste', k_help: 'Diese Hilfe', k_esc: 'Maus freigeben / schließen',
    placeholder: 'Entwicklungsdaten (Platzhalter)',
    start_tour: 'Rundgang starten', start_direct: 'Direkt loslegen', intro_skip: 'Überspringen',
    intro_1: 'Echtes 360°-Foto aus dem virtuellen Rundgang (Halle 10)', intro_2: '… überblendet in den begehbaren 3D-Zwilling',
    intro_3: 'Willkommen in Halle 10', welcome: 'Entdecke alle {t} Orte – Tab: Checkliste, M: Karte, P: echtes Foto',
    welcome_touch: 'Entdecke alle {t} Orte – links ziehen: gehen, rechts wischen: umsehen, ★: Checkliste',
    feat_1: '{t} Orte entdecken: Stationen, Infopunkte und den G1', feat_2: 'Echte Rundgang-Fotos auf dem 3D-Modell', feat_3: 'Neu: Unitree G1 mit Dex3-Händen',
    feat_2_video: 'Echte Rundgang-Fotos auf dem 3D-Modell, ergänzt durch ein Handvideo der Halle', feat_3_present: 'Neu: Unitree G1 mit Dex3-Händen an seiner heutigen Station',
    controls_short: 'WASD + Maus bewegen · E Info · Tab Checkliste · M Karte · P Panorama',
    controls_touch: 'Links ziehen: gehen · rechts wischen: umsehen · Tippen auf ★: Checkliste',
    key_mouse: 'Maus', key_space: 'Leertaste',
    progress: '{n} von {t} entdeckt', found: 'entdeckt', not_found: 'noch nicht entdeckt', badge_new: 'neu',
    badge_approx: 'Position ungefähr', badge_photo: 'nur Foto', badge_text_twin: 'Text: Zwilling', photo_only: 'Nur Foto – Lage ungefähr, kein 3D-Abgleich',
    checklist: 'Checkliste', view_pano: 'Echtes Foto ansehen (P)', loading_pano: 'Lade Panorama …',
    k_intro: 'Intro überspringen',
    splats: 'Foto-Ebene (Handvideo der Halle, Gaussian Splats)', k_splats: 'Foto-Ebene (Handvideo) an/aus',
    splats_on: 'Foto-Ebene an (Handvideo der Halle, Hauptgang)', splats_off: 'Foto-Ebene aus', splats_loading: 'Foto-Ebene lädt',
    splats_error: 'Foto-Ebene konnte nicht geladen werden', splats_none: 'Keine Foto-Ebene in diesen Daten',
    splats_auto_off: 'Foto-Ebene aus: zu langsam auf diesem Gerät (G schaltet sie wieder an)',
    station_state: 'Station G1', st_tour: 'Zustand im Rundgang', st_present: 'Heute (Handvideo der Halle)',
    station_present_on: 'Station G1: heutiger Aufbau (Handvideo der Halle)', station_tour_on: 'Station G1: Zustand im Rundgang',
    load_station: 'G1-Station (heute)', view_pano_tour: 'Foto aus dem Rundgang (früherer Zustand)',
    pano_tour_state: 'Foto aus dem Rundgang: die G1-Station ist hier im damaligen Zustand eingeblendet',
  },
  en: {
    app_title: 'ZeMA digital twin', app_sub: 'Walk the hall and discover', loading: 'Loading …', start: 'Start',
    load_manifest: 'scene manifest', load_collider: 'collision model', load_hall: 'hall model',
    load_hall_hi: 'hall model (detail)', load_robot: 'robot', load_stations: 'stations', ready: 'Ready',
    click_to_start: 'Click to start', stations: 'Stations', stations_hint: 'Click: teleport there',
    pano_mode: 'Panorama mode (P)', proj_tex: 'Photo texture (T)', map: 'Map (M)', settings: 'Settings',
    help: 'Controls', language: 'Language', quality: 'Quality', q_low: 'Low', q_medium: 'Medium', q_high: 'High',
    sensitivity: 'Mouse sensitivity', fov: 'Field of view', invert_y: 'Invert mouse Y', show_fps: 'Show FPS',
    debug_view: 'Debug view', dbg_weights: 'Pano weights', dbg_coverage: 'Coverage', dbg_baked: 'Base texture only',
    pano_opacity: 'Opacity', exit: 'Exit', reset_progress: 'Reset progress',
    discovered: 'Discovered', press_e: 'E / tap: info', near: 'Nearby', no_panos: 'No panoramas available',
    map_hint: 'Click a station to teleport · M: close', help_touch: 'Touch: left thumb to move, swipe right side to look.',
    mode_pano: 'Panorama', mode_fly: 'Fly', fly_on: 'Fly mode on (no collision)', fly_off: 'Fly mode off',
    proj_on: 'Photo texture on', proj_off: 'Photo texture off', all_found: 'All places discovered!', respawn: 'Respawned',
    k_move: 'Move', k_look: 'Look (click = capture mouse)', k_run: 'Run', k_jump: 'Jump', k_info: 'Open info',
    k_map: 'Map', k_pano: 'Panorama mode', k_panocycle: 'Next/previous panorama', k_proj: 'Photo texture on/off',
    k_fly: 'Fly mode (debug)', k_stations: 'Station list', k_help: 'This help', k_esc: 'Release mouse / close',
    placeholder: 'Development data (placeholder)',
    start_tour: 'Start the tour', start_direct: 'Jump right in', intro_skip: 'Skip',
    intro_1: 'Real 360° photo from the virtual tour (Hall 10)', intro_2: '… cross-fading into the walkable 3D twin',
    intro_3: 'Welcome to Hall 10', welcome: 'Find all {t} places – Tab: checklist, M: map, P: real photo',
    welcome_touch: 'Find all {t} places – drag left: walk, swipe right: look, ★: checklist',
    feat_1: 'Discover {t} places: stations, info points and the G1', feat_2: 'Real tour photos on the 3D model', feat_3: 'New: Unitree G1 with Dex3 hands',
    feat_2_video: 'Real tour photos on the 3D model, plus a hand-held video of the hall', feat_3_present: 'New: Unitree G1 with Dex3 hands at its station today',
    controls_short: 'WASD + mouse to move · E info · Tab checklist · M map · P panorama',
    controls_touch: 'Drag left: walk · swipe right: look · tap ★: checklist',
    key_mouse: 'Mouse', key_space: 'Space',
    progress: '{n} of {t} discovered', found: 'discovered', not_found: 'not discovered yet', badge_new: 'new',
    badge_approx: 'approximate position', badge_photo: 'photo only', badge_text_twin: 'text: twin', photo_only: 'Photo only – approximate place, no 3D alignment',
    checklist: 'Checklist', view_pano: 'View the real photo (P)', loading_pano: 'Loading panorama …',
    k_intro: 'Skip the intro',
    splats: 'Photo layer (hand-held video of the hall, Gaussian splats)', k_splats: 'Photo layer (hand-held video) on/off',
    splats_on: 'Photo layer on (hand-held video of the hall, main aisle)', splats_off: 'Photo layer off', splats_loading: 'Photo layer loading',
    splats_error: 'The photo layer could not be loaded', splats_none: 'No photo layer in this data',
    splats_auto_off: 'Photo layer off: too slow on this device (G switches it back on)',
    station_state: 'G1 station', st_tour: 'State in the tour', st_present: 'Today (hand-held video of the hall)',
    station_present_on: 'G1 station: today\'s setup (hand-held video of the hall)', station_tour_on: 'G1 station: state in the tour',
    load_station: 'G1 station (today)', view_pano_tour: 'Tour photo (earlier state)',
    pano_tour_state: 'Tour photo: the G1 station is shown here as it was then',
  },
};

let lang = 'de';

export function setLang(l) {
  lang = STR[l] ? l : 'de';
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}
export function getLang() { return lang; }
export function t(key) { return (STR[lang] && STR[lang][key]) || STR.de[key] || key; }
/** Data strings: 'text' or {de: '...', en: '...'}. */
export function pick(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v[lang] || v.de || v.en || Object.values(v)[0] || '';
}
export function defaultLang() {
  const n = (navigator.language || 'de').toLowerCase();
  return n.startsWith('de') ? 'de' : 'en';
}
