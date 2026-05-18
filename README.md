# Codzienna Krzyżówka

Codzienna krzyżówka w stylu *daily game* (à la Wordle). Każdej nocy o północy generuje się nowa łamigłówka z banku haseł, użytkownik wpisuje litery i sprawdza wynik. Z poziomu kalendarza można wrócić do dowolnego poprzedniego dnia. Redakcja (panel admina) pozwala dodawać hasła tekstowe, wizualne (obraz) i dźwiękowe (audio).

## Uruchomienie

```powershell
npm install
npm start
```

Domyślnie serwer słucha na `http://localhost:3000`.

Panel admina: `http://localhost:3000/admin.html`
Domyślne hasło: `admin` (zmień przez zmienną środowiskową `ADMIN_PASSWORD`).

```powershell
$env:ADMIN_PASSWORD = "twoje-haslo"
npm start
```

## Co jest w środku

- `server.js` — Express, API gry i admina, deterministyczny dobór haseł na dany dzień.
- `crossword.js` — generator krzyżówki (greedy + intersections).
- `public/` — frontend (vanilla JS, żadnych frameworków).
- `data/clues.json` — bank haseł.
- `data/puzzles.json` — cache wygenerowanych krzyżówek (po dacie).
- `data/uploads/` — pliki wgrane przez admina.

## Jak działa dobór codzienny

Dla każdej daty `YYYY-MM-DD` brany jest deterministyczny `seed`. Bank haseł jest tasowany, pierwsze N haseł trafia do generatora. Wygenerowana plansza jest cache'owana w `data/puzzles.json`, więc:

- dzisiejsza i przyszłe krzyżówki są usuwane z cache'u za każdym razem, gdy zmienia się bank haseł (kolejna generacja będzie świeża),
- przeszłe krzyżówki zostają nietknięte (integralność archiwum).

## Typy haseł

- **tekst** — klasyczne pytanie.
- **obraz** — np. „Jakiego kraju to flaga?” + zdjęcie flagi.
- **dźwięk** — np. „Co to za utwór?” + plik audio.

W siatce użyte są litery bez polskich znaków diakrytycznych (Ł→L, Ś→S itd.), aby zachować spójną geometrię. Oryginalne brzmienie zapisywane jest w banku.
