# Ontwikkelingsfasen app v5

Dit is een simpele, statische webapp voor Vercel + Supabase.
Er is **geen Next.js build** nodig. Daardoor verdwijnt de fout:

> Couldn't find any `pages` or `app` directory

## Inhoud
- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `supabase_schema.sql`
- `vercel.json`

## Stap voor stap

### 1. Supabase
1. Maak een Supabase-project.
2. Zet **Anonymous Sign-Ins** aan.
3. Open **SQL Editor**.
4. Plak daar de inhoud van `supabase_schema.sql` in.
5. Klik op **Run**.

### 2. Vul config.js in
Open `config.js` en vervang:
- `PLAK_HIER_JE_SUPABASE_URL`
- `PLAK_HIER_JE_SUPABASE_PUBLISHABLE_KEY`

### 3. GitHub
Upload **de inhoud** van deze map naar een lege repository.
Belangrijk: zet de bestanden direct in de root.
Je moet in GitHub meteen `index.html` zien.

### 4. Vercel
1. Importeer de repository in Vercel.
2. Als Vercel om een framework vraagt, kies **Other**.
3. Er zijn geen environment variables nodig.
4. Klik op **Deploy**.

## Belangrijke noot
Deze versie gebruikt brede anonieme rechten in Supabase, zodat de app voor jou makkelijk start.
Dat is prima voor een onderwijsprototype met beginletters en groepsscores, maar niet bedoeld voor privacygevoelige productiegegevens.
