<?php
// Biblioteka assetów Trasy Studio (PRJ-006, etap 1): pliki wspólne dla wszystkich z dostępem do edytora.
// Dane poza katalogiem www: <PLAY_ROOT>/library/ (index.json: foldery i pliki, blobs/<aa>/<sha256>.<ext>: treść raz, po hashu).
// Dostęp: ten sam klucz co publikacja (<PLAY_ROOT>/publish-key.json, nagłówek X-Publish-Key), bez kont i uprawnień.
//
// GET  ?a=get&h=<sha256>.<ext>          treść pliku (publiczna: adres to hash treści), Range, cache na rok
// GET  ?a=list                    [K]   { folders, files } (kosz razem, pole trashed); czyści kosz starszy niż 30 dni
// GET  ?a=info                    [K]   sugerowany rozmiar kawałka, limity, zajęte i wolne miejsce
// POST ?a=chunk&id&i&n            [K]   body: surowe bajty kawałka (kolejno, ponowienie tego samego i bez szkody)
// POST ?a=commit&id               [K]   body JSON { name, folder, mime, meta, thumb (JPEG base64) } → { file, dup }
// POST ?a=op                      [K]   body JSON { op: mkdir|rename|move|trash|restore|purge, ... } → { folders, files[, created] }
// Odpowiedzi JSON: {ok:true,...} albo {ok:false,error} z kodem HTTP (poza get).

declare(strict_types=1);

const MAX_FILE = 2 * 1024 * 1024 * 1024;
const CHUNK_MAX = 64 * 1024 * 1024;
const MAX_THUMB = 512 * 1024;
const TRASH_DAYS = 30;
// rozszerzenie zapisane przy treści i typ przy wysyłce; reszta jako .bin (application/octet-stream)
const MIME = [
  'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif', 'avif' => 'image/avif',
  'svg' => 'image/svg+xml', 'mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime',
  'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'ogg' => 'audio/ogg', 'oga' => 'audio/ogg', 'opus' => 'audio/ogg', 'm4a' => 'audio/mp4',
  'aac' => 'audio/aac', 'flac' => 'audio/flac', 'ttf' => 'font/ttf', 'otf' => 'font/otf', 'woff' => 'font/woff', 'woff2' => 'font/woff2',
  'gpx' => 'application/gpx+xml', 'kml' => 'application/vnd.google-earth.kml+xml', 'kmz' => 'application/vnd.google-earth.kmz',
  'fit' => 'application/octet-stream', 'tcx' => 'application/xml', 'cube' => 'text/plain', 'json' => 'application/json',
  'txt' => 'text/plain', 'csv' => 'text/csv', 'pdf' => 'application/pdf', 'zip' => 'application/zip', 'bin' => 'application/octet-stream',
];
const ORIGINS = ['https://app.trasy-studio.pl', 'https://trasy-studio.pl', 'https://www.trasy-studio.pl'];

$ROOT = getenv('PLAY_ROOT') ?: dirname(__DIR__, 3) . '/play.trasy-studio.pl';
$LIB = "$ROOT/library";
$KEYFILE = "$ROOT/publish-key.json";

function out(int $code, array $data): never {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode(($code < 400 ? ['ok' => true] : ['ok' => false]) + $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function fail(int $code, string $msg): never { out($code, ['error' => $msg]); }

function bytes_ini(string $k): int {
  $v = trim((string) ini_get($k));
  if ($v === '' || $v === '-1') return PHP_INT_MAX;
  $n = (int) $v;
  return match (strtolower(substr($v, -1))) { 'g' => $n << 30, 'm' => $n << 20, 'k' => $n << 10, default => $n };
}

$a = $_GET['a'] ?? '';

// --- treść (publiczna, adres = hash): bez CORS z listą, bo pliki trafiają do tekstur i canvasu z dowolnego źródła edytora
if ($a === 'get') {
  $h = (string) ($_GET['h'] ?? '');
  if (!preg_match('/^([0-9a-f]{64})\.([a-z0-9]{1,5})$/', $h, $m) || !isset(MIME[$m[2]])) { http_response_code(400); exit; }
  $file = "$LIB/blobs/" . substr($h, 0, 2) . "/$h";
  if (!is_file($file)) { http_response_code(404); exit; }
  $size = filesize($file);
  header('Access-Control-Allow-Origin: *');
  header('Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges');
  header('Content-Type: ' . MIME[$m[2]]);
  header('X-Content-Type-Options: nosniff');
  header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox"); // SVG bez skryptów
  header('Cache-Control: public, max-age=31536000, immutable');
  header('ETag: "' . $m[1] . '"');
  header('Accept-Ranges: bytes');
  if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === '"' . $m[1] . '"') { http_response_code(304); exit; }
  $from = 0; $to = $size - 1;
  if (preg_match('/^bytes=(\d*)-(\d*)$/', (string) ($_SERVER['HTTP_RANGE'] ?? ''), $r) && ($r[1] !== '' || $r[2] !== '')) {
    if ($r[1] === '') { $from = max(0, $size - (int) $r[2]); }
    else { $from = (int) $r[1]; if ($r[2] !== '') $to = min($to, (int) $r[2]); }
    if ($from > $to || $from >= $size) { http_response_code(416); header("Content-Range: bytes */$size"); exit; }
    http_response_code(206);
    header("Content-Range: bytes $from-$to/$size");
  }
  header('Content-Length: ' . ($to - $from + 1));
  if ($_SERVER['REQUEST_METHOD'] === 'HEAD') exit;
  @set_time_limit(0);
  while (ob_get_level()) ob_end_clean();
  $fh = fopen($file, 'rb');
  fseek($fh, $from);
  for ($left = $to - $from + 1; $left > 0 && !connection_aborted();) {
    $buf = fread($fh, min(1 << 20, $left));
    if ($buf === false || $buf === '') break;
    echo $buf; flush();
    $left -= strlen($buf);
  }
  fclose($fh);
  exit;
}

// --- CORS (edytor na app.trasy-studio.pl, dev na localhost)
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, ORIGINS, true) || preg_match('#^http://(localhost|127\.0\.0\.1)(:\d+)?$#', $origin)) {
  header("Access-Control-Allow-Origin: $origin");
  header('Vary: Origin');
  header('Access-Control-Allow-Headers: X-Publish-Key, Content-Type');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Max-Age: 600');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// --- klucz (ten sam co publikacja)
$key = (string) ($_SERVER['HTTP_X_PUBLISH_KEY'] ?? '');
if (strlen($key) < 24) fail(401, 'Brak klucza serwera albo za krótki (min. 24 znaki).');
$stored = is_file($KEYFILE) ? (json_decode((string) file_get_contents($KEYFILE), true)['hash'] ?? '') : '';
if ($stored === '' || !password_verify($key, $stored)) { usleep(300000); fail(403, 'Nieprawidłowy klucz serwera.'); }

foreach (["$LIB/blobs", "$LIB/tmp"] as $d) if (!is_dir($d) && !mkdir($d, 0700, true)) fail(500, 'Nie mogę utworzyć katalogu biblioteki.');

// --- indeks: odczyt i zmiana pod blokadą
function blank(): array { return ['v' => 1, 'folders' => [], 'files' => []]; }
function read_index(string $LIB): array {
  $f = "$LIB/index.json";
  $d = is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
  return is_array($d) ? $d + blank() : blank();
}
function with_index(string $LIB, callable $fn): mixed {
  $h = fopen("$LIB/index.json", 'c+');
  flock($h, LOCK_EX);
  $raw = stream_get_contents($h);
  $idx = ($raw ? json_decode($raw, true) : null) ?: blank();
  $idx += blank();
  try { $res = $fn($idx); }
  catch (Throwable $e) { flock($h, LOCK_UN); fclose($h); throw $e; }
  ftruncate($h, 0); rewind($h);
  fwrite($h, json_encode($idx, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
  fflush($h); flock($h, LOCK_UN); fclose($h);
  return $res;
}
function blob_path(string $LIB, string $name): string { return "$LIB/blobs/" . substr($name, 0, 2) . "/$name"; }
function new_id(): string { return bin2hex(random_bytes(6)); }
function clean_name(mixed $s): string {
  $s = trim(preg_replace('/[\x00-\x1f\x7f\/\\\\]/u', '', (string) $s) ?? '');
  if (!preg_match('/^.{1,200}$/us', $s)) throw new InvalidArgumentException('Nieprawidłowa nazwa.');
  return $s;
}
function folder_ok(array $idx, mixed $id): ?string {
  if ($id === null || $id === '') return null;
  foreach ($idx['folders'] as $f) if ($f['id'] === $id) return $id;
  throw new InvalidArgumentException('Nie ma takiego folderu.');
}
// usuwa z indeksu wpisy i treść, do której nic już się nie odwołuje
function drop(array &$idx, string $LIB, array $fileIds, array $folderIds): void {
  $idx['files'] = array_values(array_filter($idx['files'], fn($f) => !in_array($f['id'], $fileIds, true)));
  $idx['folders'] = array_values(array_filter($idx['folders'], fn($f) => !in_array($f['id'], $folderIds, true)));
  $used = [];
  foreach ($idx['files'] as $f) { $used[$f['blob']] = 1; if (!empty($f['thumb'])) $used[$f['thumb']] = 1; }
  foreach (glob("$LIB/blobs/*/*") ?: [] as $p) if (!isset($used[basename($p)])) @unlink($p);
}
// poddrzewo folderu (z nim samym)
function subtree(array $idx, array $roots): array {
  $all = $roots;
  for ($grow = true; $grow;) {
    $grow = false;
    foreach ($idx['folders'] as $f) if (in_array($f['parent'], $all, true) && !in_array($f['id'], $all, true)) { $all[] = $f['id']; $grow = true; }
  }
  return $all;
}
function purge_old(array &$idx, string $LIB): void {
  $limit = time() - TRASH_DAYS * 86400;
  $folders = array_column(array_filter($idx['folders'], fn($f) => ($f['trashed'] ?? 0) && $f['trashed'] < $limit), 'id');
  $folders = subtree($idx, $folders);
  $files = array_column(array_filter($idx['files'], fn($f) => (($f['trashed'] ?? 0) && $f['trashed'] < $limit) || in_array($f['folder'], $folders, true)), 'id');
  if ($folders || $files) drop($idx, $LIB, $files, $folders);
}
function public_index(array $idx): array { return ['folders' => $idx['folders'], 'files' => $idx['files']]; }

if ($a === 'list') {
  $idx = with_index($LIB, function (array &$idx) use ($LIB) { purge_old($idx, $LIB); return $idx; });
  out(200, public_index($idx));
}

if ($a === 'info') {
  $idx = read_index($LIB);
  $used = [];
  foreach ($idx['files'] as $f) $used[$f['blob']] = $f['size'];
  $post = bytes_ini('post_max_size');
  out(200, [
    'chunk' => max(256 * 1024, min(CHUNK_MAX, (int) ($post * 0.9))),
    'max_file' => MAX_FILE,
    'used' => array_sum($used),
    'free' => @disk_free_space($LIB) ?: null,
  ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST');
$TMP = "$LIB/tmp";
foreach (glob("$TMP/*") ?: [] as $f) if (filemtime($f) < time() - 86400) @unlink($f); // porzucone wysyłki

// --- kawałki: dopisywane kolejno do jednego pliku; i < zapisanych = ponowienie (pominięte)
if ($a === 'chunk') {
  $id = (string) ($_GET['id'] ?? '');
  $i = (int) ($_GET['i'] ?? -1);
  $n = (int) ($_GET['n'] ?? 0);
  if (!preg_match('/^[a-zA-Z0-9-]{8,64}$/', $id)) fail(400, 'Nieprawidłowe id wysyłki.');
  if ($n < 1 || $n > 10000 || $i < 0 || $i >= $n) fail(400, 'Nieprawidłowy numer kawałka.');
  $part = "$TMP/$id.part";
  $stateFile = "$TMP/$id.json";
  if ($i === 0 && !is_file($stateFile)) {
    $free = @disk_free_space($LIB);
    $need = (int) ($_GET['size'] ?? 0);
    if ($need > MAX_FILE) fail(413, 'Plik za duży (najwyżej 2 GB).');
    if ($free !== false && $need > 0 && $free < $need * 2) fail(507, 'Brak miejsca na serwerze.');
  }
  $state = is_file($stateFile) ? json_decode((string) file_get_contents($stateFile), true) : ['done' => 0, 'size' => 0];
  if ($i < $state['done']) out(200, ['received' => $i, 'repeat' => true]);
  if ($i > $state['done']) fail(409, "Oczekiwany kawałek {$state['done']}.");
  $dst = fopen($part, 'c');
  ftruncate($dst, $state['size']); // resztka po przerwanym zapisie
  fseek($dst, $state['size']);
  $size = stream_copy_to_stream(fopen('php://input', 'rb'), $dst, CHUNK_MAX + 1);
  fclose($dst);
  if ($size === 0 || $size > CHUNK_MAX) fail(413, 'Pusty albo za duży kawałek.');
  if ($state['size'] + $size > MAX_FILE) { @unlink($part); @unlink($stateFile); fail(413, 'Plik za duży (najwyżej 2 GB).'); }
  file_put_contents($stateFile, json_encode(['done' => $i + 1, 'size' => $state['size'] + $size, 'n' => $n]));
  out(200, ['received' => $i]);
}

// --- zatwierdzenie: hash treści, plik do blobs (raz), wpis w indeksie
if ($a === 'commit') {
  $id = (string) ($_GET['id'] ?? '');
  if (!preg_match('/^[a-zA-Z0-9-]{8,64}$/', $id)) fail(400, 'Nieprawidłowe id wysyłki.');
  $part = "$TMP/$id.part";
  $state = is_file("$TMP/$id.json") ? json_decode((string) file_get_contents("$TMP/$id.json"), true) : null;
  if (!$state || $state['done'] !== $state['n'] || !is_file($part)) fail(400, 'Wysyłka niepełna.');
  $body = json_decode((string) file_get_contents('php://input'), true) ?: [];
  try { $name = clean_name($body['name'] ?? ''); } catch (Throwable $e) { fail(400, $e->getMessage()); }
  @set_time_limit(300);
  $hash = hash_file('sha256', $part);
  $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
  if (!isset(MIME[$ext])) $ext = 'bin';
  $blob = "$hash.$ext";
  $dst = blob_path($LIB, $blob);
  if (!is_dir(dirname($dst))) mkdir(dirname($dst), 0700, true);
  if (is_file($dst)) unlink($part); else rename($part, $dst);
  @unlink("$TMP/$id.json");
  $thumb = null;
  if (is_string($body['thumb'] ?? null) && strlen($body['thumb']) < MAX_THUMB * 1.4) {
    $jpg = base64_decode($body['thumb'], true);
    if ($jpg !== false && str_starts_with($jpg, "\xFF\xD8\xFF")) {
      $thumb = hash('sha256', $jpg) . '.jpg';
      $tp = blob_path($LIB, $thumb);
      if (!is_dir(dirname($tp))) mkdir(dirname($tp), 0700, true);
      if (!is_file($tp)) file_put_contents($tp, $jpg);
    }
  }
  $meta = is_array($body['meta'] ?? null) ? $body['meta'] : [];
  if (strlen(json_encode($meta)) > 16384) $meta = [];
  try {
    $res = with_index($LIB, function (array &$idx) use ($name, $body, $hash, $blob, $thumb, $meta, $state) {
      $folder = folder_ok($idx, $body['folder'] ?? null);
      foreach ($idx['files'] as $f) if ($f['hash'] === $hash && empty($f['trashed'])) return ['file' => $f, 'dup' => true];
      $mime = (string) ($body['mime'] ?? '');
      $f = ['id' => new_id(), 'name' => $name, 'folder' => $folder, 'hash' => $hash, 'blob' => $blob, 'thumb' => $thumb,
        'mime' => preg_match('#^[a-z]+/[a-z0-9.+-]{1,80}$#i', $mime) ? $mime : '', 'size' => $state['size'], 'date' => time(), 'meta' => $meta, 'trashed' => 0];
      $idx['files'][] = $f;
      return ['file' => $f, 'dup' => false];
    });
  } catch (InvalidArgumentException $e) { fail(400, $e->getMessage()); }
  out(200, $res);
}

// --- zmiany drzewa: zawsze cały indeks w odpowiedzi
if ($a === 'op') {
  $b = json_decode((string) file_get_contents('php://input'), true) ?: [];
  try {
    $created = null;
    $idx = with_index($LIB, function (array &$idx) use ($b, $LIB, &$created) {
      $ids = array_map('strval', (array) ($b['ids'] ?? []));
      $isFolder = fn($id) => in_array($id, array_column($idx['folders'], 'id'), true);
      switch ($b['op'] ?? '') {
        case 'mkdir':
          $created = new_id();
          $idx['folders'][] = ['id' => $created, 'name' => clean_name($b['name'] ?? ''), 'parent' => folder_ok($idx, $b['parent'] ?? null), 'trashed' => 0];
          break;
        case 'rename':
          $name = clean_name($b['name'] ?? '');
          foreach (['folders', 'files'] as $k) foreach ($idx[$k] as &$x) if ($x['id'] === ($b['id'] ?? '')) $x['name'] = $name;
          unset($x);
          break;
        case 'move':
          $to = folder_ok($idx, $b['folder'] ?? null);
          $moving = array_values(array_filter($ids, $isFolder));
          if ($to !== null && in_array($to, subtree($idx, $moving), true)) throw new InvalidArgumentException('Folderu nie można przenieść do niego samego.');
          foreach ($idx['folders'] as &$x) if (in_array($x['id'], $ids, true)) $x['parent'] = $to;
          foreach ($idx['files'] as &$x) if (in_array($x['id'], $ids, true)) $x['folder'] = $to;
          unset($x);
          break;
        case 'trash':
        case 'restore':
          $t = $b['op'] === 'trash' ? time() : 0;
          foreach (['folders', 'files'] as $k) foreach ($idx[$k] as &$x) if (in_array($x['id'], $ids, true)) {
            $x['trashed'] = $t;
            if ($t === 0 && $k === 'files' && $x['folder'] !== null && !in_array($x['folder'], array_column($idx['folders'], 'id'), true)) $x['folder'] = null;
            if ($t === 0 && $k === 'folders' && $x['parent'] !== null && !in_array($x['parent'], array_column($idx['folders'], 'id'), true)) $x['parent'] = null;
          }
          unset($x);
          break;
        case 'purge':
          $folders = subtree($idx, array_values(array_filter($ids, $isFolder)));
          $files = array_column(array_filter($idx['files'], fn($f) => in_array($f['id'], $ids, true) || in_array($f['folder'], $folders, true)), 'id');
          drop($idx, $LIB, $files, $folders);
          break;
        default:
          throw new InvalidArgumentException('Nieznana operacja.');
      }
      return $idx;
    });
  } catch (InvalidArgumentException $e) { fail(400, $e->getMessage()); }
  out(200, public_index($idx) + ($created ? ['created' => $created] : []));
}

fail(400, 'Nieznana akcja.');
