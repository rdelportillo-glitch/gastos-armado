// Archivo "PLANTILLA ENVIOS DE DINERO.xlsx" con la misma estructura de la plantilla original del banco:
//  hoja 1 "archivo proveedores" (encabezados en negrilla alineados a la izquierda, Calibri 11, anchos de columna, filtro en el encabezado,
//  columna de número de cuenta con formato "0") y una segunda hoja "Hoja1" vacía.
// La librería xlsx (SheetJS) no escribe estilos, por eso el archivo se arma aquí con sus partes XML y se comprime con fflate.
// filas: [encabezados, ...filas]; los números van como número y el texto como texto compartido (como lo guarda Excel).

const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COL = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ANCHOS = [22.109375, 23.33203125, 13.44140625, 16.21875, 15, 14.6640625, 19.6640625, 17.88671875]; // los de la plantilla original
const CUENTA = 6; // columna G: número de cuenta

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
  + '<xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
  + '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>';

export async function buildPlantillaPagoXlsx(filas) {
  const { zipSync, strToU8 } = await import("fflate");
  const textos = [], indice = new Map();
  const idx = (s) => { const k = String(s); if (!indice.has(k)) { indice.set(k, textos.length); textos.push(k); } return indice.get(k); };

  const filasXml = filas.map((fila, r) => {
    const n = r + 1;
    const celdas = fila.map((v, c) => {
      if (v === "" || v === null || v === undefined) return "";
      const ref = COL[c] + n;
      const estilo = r === 0 ? (c === CUENTA ? 2 : 1) : (c === CUENTA ? 3 : 0);
      const s = estilo ? ` s="${estilo}"` : "";
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
      return `<c r="${ref}"${s} t="s"><v>${idx(v)}</v></c>`;
    }).join("");
    return `<row r="${n}" spans="1:8">${celdas}</row>`;
  }).join("");

  const sheet1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<dimension ref="A1:H${filas.length}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews><sheetFormatPr baseColWidth="10" defaultRowHeight="14.4"/>`
    + "<cols>" + ANCHOS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}"${i === CUENTA ? ' style="3"' : ""} customWidth="1"/>`).join("") + "</cols>"
    + `<sheetData>${filasXml}</sheetData><autoFilter ref="A1:H1"/>`
    + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait"/></worksheet>';
  const sheet2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr baseColWidth="10" defaultRowHeight="14.4"/><sheetData/>'
    + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  const sst = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${textos.length}" uniqueCount="${textos.length}">` + textos.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join("") + "</sst>";
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<workbookPr defaultThemeVersion="166925"/><bookViews><workbookView xWindow="-108" yWindow="-108" windowWidth="23256" windowHeight="12456"/></bookViews>'
    + '<sheets><sheet name="archivo proveedores" sheetId="1" r:id="rId1"/><sheet name="Hoja1" sheetId="2" r:id="rId2"/></sheets>'
    + `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'archivo proveedores'!$A$1:$H$1</definedName></definedNames><calcPr calcId="191029"/></workbook>`;
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
  const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  const ahora = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:creator>Biver Operaciones</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${ahora}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${ahora}</dcterms:modified></cp:coreProperties>`;
  const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Biver Operaciones</Application></Properties>';

  const zip = zipSync({
    "[Content_Types].xml": strToU8(tipos), "_rels/.rels": strToU8(rels), "docProps/core.xml": strToU8(core), "docProps/app.xml": strToU8(app),
    "xl/workbook.xml": strToU8(workbook), "xl/_rels/workbook.xml.rels": strToU8(wbRels), "xl/styles.xml": strToU8(STYLES), "xl/sharedStrings.xml": strToU8(sst),
    "xl/worksheets/sheet1.xml": strToU8(sheet1), "xl/worksheets/sheet2.xml": strToU8(sheet2),
  }, { level: 6 });
  return new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
