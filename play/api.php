<?php
// Publikacja paczek playera Trasy Studio (Export → Opublikuj online) i lista dla galerii.
// Playery leżą poza repo strony: <PLAY_ROOT>/public_html/p/<slug>/ = https://play.trasy-studio.pl/p/<slug>/
// Klucz (hash) i pliki tymczasowe: <PLAY_ROOT>/, poza katalogiem www.
//
// GET  ?a=list                          lista playerów (publiczna)
// GET  ?a=info                    [K]   limity serwera, sugerowany rozmiar kawałka
// POST ?a=setup                   [K]   pierwsze ustawienie klucza (tylko gdy jeszcze go nie ma)
// POST ?a=chunk&id&i&n&slug[&size&title&aspect&replace=1]  [K]  body: surowe bajty kawałka ZIP
//      (Content-Type: application/octet-stream); ostatni kawałek publikuje
// POST ?a=delete&slug             [K]   usunięcie playera
// [K] = nagłówek X-Publish-Key. Odpowiedzi JSON: {ok:true,...} albo {ok:false,error} z kodem HTTP.

declare(strict_types=1);

const MAX_TOTAL = 400 * 1024 * 1024;   // ZIP i suma po rozpakowaniu
const MAX_FILES = 6000;
const CHUNK_MAX = 8 * 1024 * 1024;
const EXT = ['html', 'js', 'css', 'json', 'wasm', 'bin', 'exr', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'woff', 'woff2', 'ttf', 'otf',
  'mp3', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'wav', 'txt'];
const ORIGINS = ['https://app.trasy-studio.pl', 'https://trasy-studio.pl', 'https://www.trasy-studio.pl'];

$ROOT = getenv('PLAY_ROOT') ?: dirname(__DIR__, 3) . '/play.trasy-studio.pl';
$PUB = "$ROOT/public_html";
$TMP = "$ROOT/publish-tmp";
$KEYFILE = "$ROOT/publish-key.json";
$URL = rtrim(getenv('PLAY_URL') ?: 'https://play.trasy-studio.pl', '/');

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

function rrmdir(string $d): void {
  if (!is_dir($d)) return;
  foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f)
    $f->isDir() && !$f->isLink() ? rmdir($f->getPathname()) : unlink($f->getPathname());
  rmdir($d);
}

function valid_slug(string $s): bool { return (bool) preg_match('/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/', $s); }

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

$a = $_GET['a'] ?? '';

// --- lista (publiczna)
function read_index(string $PUB): array {
  $f = "$PUB/index.json";
  return is_file($f) ? (json_decode((string) file_get_contents($f), true) ?: []) : [];
}
if ($a === 'list') out(200, ['players' => read_index($PUB)]);

// --- klucz
$key = (string) ($_SERVER['HTTP_X_PUBLISH_KEY'] ?? '');
if (strlen($key) < 24) fail(401, 'Brak klucza publikacji albo za krótki (min. 24 znaki).');
if ($a === 'setup') {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST');
  if (!is_dir($ROOT)) fail(500, 'Brak katalogu subdomeny play.');
  $h = @fopen($KEYFILE, 'x');
  if (!$h) fail(409, 'Klucz jest już ustawiony.');
  fwrite($h, json_encode(['hash' => password_hash($key, PASSWORD_DEFAULT)]));
  fclose($h);
  out(201, ['setup' => true]);
}
$stored = is_file($KEYFILE) ? (json_decode((string) file_get_contents($KEYFILE), true)['hash'] ?? '') : '';
if ($stored === '' || !password_verify($key, $stored)) { usleep(300000); fail(403, 'Nieprawidłowy klucz publikacji.'); }

// --- pliki ochronne w katalogu playerów (tworzone raz)
function ensure_dirs(string $PUB, string $TMP): void {
  foreach ([$TMP, "$PUB/p"] as $d) if (!is_dir($d) && !mkdir($d, 0755, true)) fail(500, "Nie mogę utworzyć $d");
  foreach (glob("$TMP/*") ?: [] as $d) if (filemtime($d) < time() - 86400) rrmdir($d); // porzucone wysyłki
  $rootHt = "$PUB/.htaccess";
  if (!is_file($rootHt)) file_put_contents($rootHt, "# Trasy Studio play: playery w p/<slug>/, galeria na trasy-studio.pl/play/\n"
    . "RedirectMatch 302 ^/$ https://trasy-studio.pl/play/\n"
    . "AddType application/wasm .wasm\n"
    . "<FilesMatch \"\\.(php\\d?|phtml|phar|phps|cgi|pl|py|sh)$\">\n  Require all denied\n</FilesMatch>\n");
  if (!is_file("$PUB/p/.htaccess")) file_put_contents("$PUB/p/.htaccess", "RemoveHandler .php .phtml .phar\nRemoveType .php .phtml .phar\n"
    . "<FilesMatch \"\\.(php\\d?|phtml|phar|phps|cgi|pl|py|sh|htaccess)$\">\n  Require all denied\n</FilesMatch>\n"
    . "<IfModule mod_headers.c>\n  Header set X-Content-Type-Options nosniff\n</IfModule>\n");
}

if ($a === 'info') {
  $post = bytes_ini('post_max_size');
  out(200, [
    'chunk' => max(256 * 1024, min(CHUNK_MAX, (int) ($post * 0.9))),
    'post_max_size' => ini_get('post_max_size'),
    'max_execution_time' => ini_get('max_execution_time'),
    'memory_limit' => ini_get('memory_limit'),
    'max_total' => MAX_TOTAL,
    'free' => @disk_free_space($ROOT) ?: null,
    'php' => PHP_VERSION,
  ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST');
ensure_dirs($PUB, $TMP);

// --- usunięcie
if ($a === 'delete') {
  $slug = (string) ($_GET['slug'] ?? '');
  if (!valid_slug($slug)) fail(400, 'Nieprawidłowy slug.');
  $dir = "$PUB/p/$slug";
  if (!is_dir($dir)) fail(404, 'Nie ma takiego playera.');
  $trash = "$TMP/del-" . bin2hex(random_bytes(6));
  rename($dir, $trash);
  rrmdir($trash);
  update_index($PUB, fn(array $list) => array_values(array_filter($list, fn($p) => $p['slug'] !== $slug)));
  out(200, ['deleted' => $slug]);
}

if ($a !== 'chunk') fail(400, 'Nieznana akcja.');

// --- kawałki
$id = (string) ($_GET['id'] ?? '');
$i = (int) ($_GET['i'] ?? -1);
$n = (int) ($_GET['n'] ?? 0);
$slug = (string) ($_GET['slug'] ?? '');
if (!preg_match('/^[a-zA-Z0-9-]{8,64}$/', $id)) fail(400, 'Nieprawidłowe id wysyłki.');
if (!valid_slug($slug)) fail(400, 'Nieprawidłowy slug (a-z, 0-9, myślnik).');
if ($n < 1 || $n > 1000 || $i < 0 || $i >= $n) fail(400, 'Nieprawidłowy numer kawałka.');
$replace = ($_GET['replace'] ?? '') === '1';
if ($i === 0) { // szybkie odmowy przed wysłaniem całej paczki
  if (is_dir("$PUB/p/$slug") && !$replace) fail(409, 'Ten slug jest zajęty (replace=1 nadpisuje player pod tym samym adresem).');
  $need = (int) ($_GET['size'] ?? 0) * 2;
  $free = @disk_free_space($ROOT);
  if ($need > MAX_TOTAL * 2) fail(413, 'Paczka za duża.');
  if ($free !== false && $need > 0 && $free < $need) fail(507, 'Brak miejsca na serwerze.');
}

$part = "$TMP/up-$id";
if (!is_dir($part)) mkdir($part, 0700);
$in = fopen('php://input', 'rb');
$dst = fopen("$part/$i", 'wb');
$size = stream_copy_to_stream($in, $dst, CHUNK_MAX + 1);
fclose($dst);
if ($size === 0 || $size > CHUNK_MAX) { rrmdir($part); fail(413, 'Pusty albo za duży kawałek.'); }
$total = 0;
foreach (glob("$part/*") as $f) $total += filesize($f);
if ($total > MAX_TOTAL) { rrmdir($part); fail(413, 'Paczka za duża.'); }
if ($i < $n - 1) out(200, ['received' => $i]);

// --- ostatni kawałek: złożenie, kontrola, rozpakowanie, podmiana katalogu
@set_time_limit(300);
for ($k = 0; $k < $n; $k++) if (!is_file("$part/$k")) { rrmdir($part); fail(400, "Brak kawałka $k."); }
$zipFile = "$part/package.zip";
$z = fopen($zipFile, 'wb');
for ($k = 0; $k < $n; $k++) { $c = fopen("$part/$k", 'rb'); stream_copy_to_stream($c, $z); fclose($c); unlink("$part/$k"); }
fclose($z);

$new = "$part/out";
try { $info = unzip_safe($zipFile, $new); }
catch (Throwable $e) { rrmdir($part); fail(422, 'Paczka odrzucona: ' . $e->getMessage()); }
if (!is_file("$new/player.html") || !is_file("$new/config.json")) { rrmdir($part); fail(422, 'To nie jest paczka playera (brak player.html / config.json).'); }

$config = json_decode((string) file_get_contents("$new/config.json"), true) ?: [];
$project = is_file("$new/project.json") ? (json_decode((string) file_get_contents("$new/project.json"), true) ?: []) : [];
$title = trim((string) ($_GET['title'] ?? '')) ?: (string) ($config['title'] ?? $slug);
$aspect = (string) ($_GET['aspect'] ?? '');
if (!preg_match('/^\d{1,5}:\d{1,5}$/', $aspect)) {
  $w = (int) ($project['output']['width'] ?? 16); $h = (int) ($project['output']['height'] ?? 9);
  $aspect = ($w > 0 && $h > 0) ? "$w:$h" : '16:9';
}

$dir = "$PUB/p/$slug";
$old = "$part/old";
if (is_dir($dir) && !$replace) { rrmdir($part); fail(409, 'Ten slug jest zajęty.'); }
if (is_dir($dir)) rename($dir, $old);
if (!rename($new, $dir)) { if (is_dir($old)) rename($old, $dir); rrmdir($part); fail(500, 'Nie udało się podmienić katalogu.'); }
rrmdir($part);

$url = "$URL/p/$slug/player.html";
$entry = [
  'slug' => $slug, 'title' => preg_match('/^.{1,120}/us', $title, $m) ? $m[0] : $slug, 'aspect' => $aspect, 'url' => $url,
  'poster' => is_file("$dir/poster.jpg") ? "$URL/p/$slug/poster.jpg" : null,
  'size' => $info['size'], 'files' => $info['files'], 'date' => gmdate('c'),
];
update_index($PUB, function (array $list) use ($entry) {
  $list = array_values(array_filter($list, fn($p) => $p['slug'] !== $entry['slug']));
  array_unshift($list, $entry);
  return $list;
});
out(200, ['player' => $entry]);

// --- pomocnicze
function update_index(string $PUB, callable $fn): void {
  $h = fopen("$PUB/index.json", 'c+');
  flock($h, LOCK_EX);
  $list = json_decode((string) stream_get_contents($h), true) ?: [];
  $list = $fn($list);
  ftruncate($h, 0); rewind($h);
  fwrite($h, json_encode($list, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
  flock($h, LOCK_UN); fclose($h);
}

// Rozpakowanie bez rozszerzenia zip: katalog centralny, metody 0 (stored) i 8 (deflate).
// Biała lista rozszerzeń, bez ../ i ścieżek bezwzględnych, limity liczby plików i sumy rozmiaru.
function unzip_safe(string $file, string $dest): array {
  $fsize = filesize($file);
  $h = fopen($file, 'rb');
  $tail = min($fsize, 65557);
  fseek($h, $fsize - $tail);
  $buf = fread($h, $tail);
  $p = strrpos($buf, "PK\x05\x06");
  if ($p === false) throw new RuntimeException('to nie jest ZIP');
  $eocd = unpack('vdisk/vcdisk/ventries/vtotal/Vcdsize/Vcdoff', substr($buf, $p + 4, 16));
  if ($eocd['total'] > MAX_FILES) throw new RuntimeException('za dużo plików');
  fseek($h, $eocd['cdoff']);
  $cd = fread($h, $eocd['cdsize']);
  mkdir($dest, 0755, true);
  $off = 0; $sum = 0; $count = 0;
  for ($e = 0; $e < $eocd['total']; $e++) {
    if (substr($cd, $off, 4) !== "PK\x01\x02") throw new RuntimeException('uszkodzony katalog ZIP');
    $c = unpack('vver/vneed/vflag/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnlen/vxlen/vclen/vdisk/viattr/Vxattr/Vloff', substr($cd, $off + 4, 42));
    $name = substr($cd, $off + 46, $c['nlen']);
    $off += 46 + $c['nlen'] + $c['xlen'] + $c['clen'];
    if (str_ends_with($name, '/')) continue;
    $parts = explode('/', $name);
    if ($name === '' || $name[0] === '/' || str_contains($name, '\\') || str_contains($name, "\0") || in_array('..', $parts, true) || in_array('', $parts, true) || in_array('.', $parts, true))
      throw new RuntimeException("niedozwolona ścieżka: $name");
    foreach ($parts as $seg) if ($seg[0] === '.') throw new RuntimeException("ukryty plik: $name");
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!in_array($ext, EXT, true)) throw new RuntimeException("niedozwolony typ pliku: $name");
    if ($c['usize'] === 0xFFFFFFFF || $c['csize'] === 0xFFFFFFFF) throw new RuntimeException('ZIP64 nieobsługiwany');
    $sum += $c['usize'];
    if ($sum > MAX_TOTAL) throw new RuntimeException('za duża po rozpakowaniu');
    if (++$count > MAX_FILES) throw new RuntimeException('za dużo plików');
    fseek($h, $c['loff']);
    $lh = unpack('Vsig/vneed/vflag/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnlen/vxlen', fread($h, 30));
    if ($lh['sig'] !== 0x04034b50) throw new RuntimeException('uszkodzony nagłówek pliku');
    fseek($h, $c['loff'] + 30 + $lh['nlen'] + $lh['xlen']);
    $raw = $c['csize'] > 0 ? fread($h, $c['csize']) : '';
    $data = match ($c['method']) {
      0 => $raw,
      8 => @gzinflate($raw, $c['usize'] + 1),
      default => throw new RuntimeException("nieobsługiwana kompresja: $name"),
    };
    if ($data === false || strlen($data) !== $c['usize'] || (crc32($data) & 0xFFFFFFFF) !== $c['crc']) throw new RuntimeException("błąd danych: $name");
    $path = "$dest/$name";
    if (!is_dir(dirname($path))) mkdir(dirname($path), 0755, true);
    file_put_contents($path, $data);
  }
  fclose($h);
  return ['size' => $sum, 'files' => $count];
}
