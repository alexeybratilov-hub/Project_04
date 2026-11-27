using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Windows.Forms;
using System.Xml;

namespace OtBaza
{
    /// <summary>Просмотр DOCX внутри приложения: текст документа без Word.</summary>
    internal sealed class DocxPreviewForm : GlassForm
    {
        private readonly string _path;

        public DocxPreviewForm(string path)
            : base("Просмотр документа", new Size(780, 660))
        {
            _path = path;

            var footer = new TransparentFlow
            {
                Dock = DockStyle.Bottom,
                Height = 52,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(0, 8, 0, 0)
            };
            Body.Controls.Add(footer);

            var close = new PillButton { Text = "Закрыть", Width = 118, Height = 36 };
            close.Click += delegate { Close(); };
            footer.Controls.Add(close);

            var openFolder = new PillButton { Text = "Открыть папку", Width = 160, Height = 36, Margin = new Padding(0, 0, 8, 0) };
            openFolder.Click += delegate
            {
                try { System.Diagnostics.Process.Start("explorer.exe", "\"" + Path.GetDirectoryName(path) + "\""); }
                catch (Exception ex) { MessageBox.Show(ex.Message, "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            };
            footer.Controls.Add(openFolder);

            var pdf = new PillButton { Text = "Сохранить PDF", Primary = true, Width = 170, Height = 36, Margin = new Padding(0, 0, 8, 0) };
            pdf.Click += delegate { SavePdf(); };
            footer.Controls.Add(pdf);

            var fileName = new Label
            {
                Dock = DockStyle.Top,
                Height = 24,
                ForeColor = Ui.Muted,
                BackColor = Color.Transparent,
                Font = Ui.Font(11.5f),
                Text = Path.GetFileName(path)
            };
            Body.Controls.Add(fileName);

            var box = new RichTextBox
            {
                Dock = DockStyle.Fill,
                ReadOnly = true,
                BorderStyle = BorderStyle.None,
                BackColor = Color.FromArgb(0xFB, 0xFD, 0xFF),
                ForeColor = Ui.Ink,
                Font = Ui.Font(13f),
                WordWrap = true,
                DetectUrls = false
            };
            box.Text = ExtractText(path);
            box.Select(0, 0);
            Body.Controls.Add(box);
            box.BringToFront();
        }

        private void SavePdf()
        {
            try
            {
                string pdfPath = Path.ChangeExtension(_path, ".pdf");
                PdfService.Save(pdfPath, Path.GetFileNameWithoutExtension(_path), ExtractText(_path));
                string question = "PDF сохранён:\n" + pdfPath + "\n\nОткрыть его сейчас?";
                if (MessageBox.Show(question, "PDF", MessageBoxButtons.YesNo, MessageBoxIcon.Information) != DialogResult.Yes) return;
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(pdfPath) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось сохранить PDF: " + ex.Message, "ОТ-База", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        public static string ExtractText(string path)
        {
            try
            {
                using (var archive = ZipFile.OpenRead(path))
                {
                    var entry = archive.GetEntry("word/document.xml");
                    if (entry == null) return "Документ не содержит текста.";
                    var builder = new StringBuilder();
                    using (var reader = XmlReader.Create(entry.Open()))
                    {
                        while (reader.Read())
                        {
                            if (reader.NodeType != XmlNodeType.Element) continue;
                            if (reader.LocalName == "t")
                            {
                                builder.Append(reader.ReadElementContentAsString());
                            }
                            else if (reader.LocalName == "tab")
                            {
                                builder.Append('\t');
                            }
                            else if (reader.LocalName == "br")
                            {
                                builder.Append('\n');
                            }
                            else if (reader.LocalName == "p" && builder.Length > 0 && builder[builder.Length - 1] != '\n')
                            {
                                builder.Append('\n');
                            }
                        }
                    }
                    string text = builder.ToString().Trim();
                    return text.Length == 0 ? "Документ пуст." : text;
                }
            }
            catch (Exception ex)
            {
                return "Не удалось прочитать документ: " + ex.Message;
            }
        }
    }
}
