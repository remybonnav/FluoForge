<p align="center">
  <img src="../assets/FluoForge-logo-Github-viridis.svg" alt="FluoForge logo" width="360">
</p>

# FluoForge user manual

FluoForge is a figure editor for multichannel fluorescence microscopy that runs in your web browser. You import TIFF stacks straight from ImageJ/Fiji (or JPEG/PNG/BMP), choose which channels to show and how bright they are, lay the panels out on a page, add scale bars, insets, arrows, shapes and labels, and export a publication figure as TIFF, SVG or PDF. The original image data is kept inside the project, so every display setting stays editable.

The figure below was made entirely in FluoForge, and the rest of this manual shows how. The example images are four-channel immunofluorescence sections (DAPI, ERG, EdU, CD31) from the project author.

![Finished example figure: a 2 × 5 grid of single channels and merges for two cohorts, two magnified insets with an arrow, a dashed circle and labels, scale bars and a caption box](images/19-final-figure.jpg)

## Contents

1. [Starting FluoForge](#1-starting-fluoforge)
2. [The workspace](#2-the-workspace)
3. [Importing images](#3-importing-images)
4. [Channels, contrast and calibration](#4-channels-contrast-and-calibration)
5. [Z stacks and time series](#5-z-stacks-and-time-series)
6. [Laying out panels with the Grid tool](#6-laying-out-panels-with-the-grid-tool)
7. [Selecting, moving, aligning and locking](#7-selecting-moving-aligning-and-locking)
8. [Cropping an image](#8-cropping-an-image)
9. [Scale bars](#9-scale-bars)
10. [Insets](#10-insets)
11. [Shapes](#11-shapes)
12. [Pen and paths (arrows, outlines)](#12-pen-and-paths-arrows-outlines)
13. [Text and captions](#13-text-and-captions)
14. [Cropping an image to a shape](#14-cropping-an-image-to-a-shape)
15. [Pages and document properties](#15-pages-and-document-properties)
16. [Layers](#16-layers)
17. [Undo and the History panel](#17-undo-and-the-history-panel)
18. [Saving, versions and recovery](#18-saving-versions-and-recovery)
19. [Exporting the figure](#19-exporting-the-figure)
20. [Themes](#20-themes)
21. [Keyboard shortcuts](#21-keyboard-shortcuts)
22. [Tips and troubleshooting](#22-tips-and-troubleshooting)

---

## 1. Starting FluoForge

FluoForge is a static web page with nothing to install. In the project folder, start a local web server and open the page:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/` in Chrome, Edge or Firefox. Chrome and Edge can also save a project back into the same file (see [Saving](#18-saving-versions-and-recovery)).

FluoForge works offline. Every library and font it needs is included in the project folder, so it runs without an internet connection and behind an institute firewall. The page also refuses to load anything from another website: your images never leave your computer.

The workspace starts empty. Click **Create figure** to start a new figure, or **Open project** to continue one you saved.

![Start screen with the Create figure and Open project buttons](images/01-start-screen.png)

**Create figure** asks for the page:

<img src="images/02-new-figure.png" alt="Create a figure dialog with project name, width, height, unit, DPI and number of pages" width="340">

| Field | Meaning |
|---|---|
| Project name | Used for the project file and every export file name. |
| Width / Height | Page size, in the chosen unit. The default 21 × 14.8 cm is A5 landscape (half an A4 page). |
| Unit | Pixels, cm or inches. |
| DPI | Output resolution. At 300 DPI a 21 cm page is 2480 pixels wide. Positions and sizes in the editor are in these pixels. |
| Pages | Number of pages (all the same size). You can add pages later. |

Everything except the name can be changed later in [Document properties](#15-pages-and-document-properties).

## 2. The workspace

![The FluoForge workspace with two imported images and the Channels panel](images/03-import-channels.jpg)

- **Top bar, first row**: the tools (**Select**, **Crop**, **Text**, **Scale bar**, **Shape**, **Pen / Path**, **Inset**, **Grid**), zoom (− / + / 1:1 / **Fit selection**), the page menu and **+ Page**, then **Duplicate**, **Undo** and **Redo**.
- **Top bar, second row**: **Import Image**, **New figure**, **Document**, **Save Project**, **Save As**, **Versions**, **Open project**, **Export** and the **Theme** menu.
- **Selection bar** (under the top bar): what is selected, its exact position, size and rotation, and the actions that apply to it. See [section 7](#7-selecting-moving-aligning-and-locking).
- **Canvas**: the white page(s) on a checkered pasteboard. Objects left on the pasteboard are kept in the project but are not exported.
- **Inspector** (right): collapsible panels for Document Properties, Layers, History, Channels and the active tool. Click a panel header to collapse or expand it; the **−** button collapses all of them. Which panels are collapsed is remembered. Selecting objects never opens, closes or moves a panel.

**Zoom**: the − and + buttons (or the `-`, `+` and `0` keys) zoom around the selected object, or around the centre of the view when nothing is selected. Ctrl + mouse wheel zooms around the selection or the cursor. **1:1** returns to 100 %, and **Fit selection** (Shift+2) fits the selection in the view.

## 3. Importing images

Click **Import Image** (you can choose several files at once). Supported formats:

| Format | What FluoForge reads |
|---|---|
| TIFF (8-, 12-, 16- or 32-bit, one page per channel) | Every channel at full bit depth, plus what ImageJ/Fiji saved: channel colours (LUTs), per-channel display ranges, channel labels and pixel size (µm/px). 32-bit float and signed 16-bit images keep their exact values, negative ones included; packed 12-bit camera files show as 12-bit. |
| RGB TIFF (8- or 16-bit) | Three channels, Red, Green and Blue, each with its colour. 8-bit RGB is shown at its full 0–255 range. |
| OME-TIFF (`.ome.tif`, from Bio-Formats, Fiji, OMERO and many microscopes) | Channels, Z slices and time frames in the file's dimension order, pixel size with its unit (nm, µm, mm, ...), Z step, channel names and colours, and the bit depth the file states (12-bit data in a 16-bit file shows as 12-bit). If the file holds several images (series), the first is shown. |
| ImageJ hyperstacks (channels × Z slices × time frames) | See [Z stacks and time series](#5-z-stacks-and-time-series). |
| CZI, LIF, ND2 and other microscope formats | Not read directly: a browser cannot decode them. Convert them to OME-TIFF in Fiji (see below). |
| JPEG, PNG, BMP | Three channels (red, green, blue) shown at their full 0–255 range. PNG transparency is kept. These files carry no pixel size; enter it by hand to use scale bars. |

**Converting microscope files.** FluoForge comes with a Fiji macro, `tools/Export_for_FluoForge.ijm` (the error shown when you import a CZI, LIF or ND2 file links to it). In Fiji, choose *Plugins ▸ Macros ▸ Run...*, pick the macro, then a folder of microscope files and a folder for the results. It converts every file Bio-Formats can read to OME-TIFF, one file per image (series), keeping the channels, Z slices, time frames, pixel size and channel names; files that already exist are skipped. Bio-Formats keeps the original metadata in the OME-TIFF, including the path of the source file. The macro can also run without a window: `fiji --headless --run Export_for_FluoForge.ijm "input='/data/raw',output='/data/ome'"`. BigTIFF files (the TIFF variant for files over 4 GB) cannot be imported yet.

**Image info** (in the Channels panel) shows where the dimensions came from: the OME-XML, the ImageJ header, or the page count.

Images keep their full resolution for export. On screen, very large images (more than 2048 px on the long side) are shown with a reduced preview so that editing stays fast.

How the displayed colours are made follows Fiji and QuPath: each channel's value is mapped through *min*, *max* and gamma to one of 256 levels of its colour, and the channels are added together. When an image is shown or exported smaller than its pixels, each pixel is the average of the source pixels it covers, so fine detail is smoothed rather than turned into false patterns (moiré). This works best when an image is reduced to half its size or less; a slight reduction can leave a faint pattern in very fine, regular detail. When it is shown larger, every source pixel stays a sharp square. The colours are computed in the background, so the sliders stay smooth even for large images.

## 4. Channels, contrast and calibration

Select an image to show its channels in the **Channels** panel (see the screenshot in [section 2](#2-the-workspace)). For each channel:

- **Checkbox**: shows or hides the channel. Single-channel panels are made by duplicating an image and leaving one channel on.
- **Colour (LUT)**: the button shows the channel's colour table as a gradient. Click it (or press Enter) to choose another, grouped as:
  - **Colour-blind safe**: viridis, cividis, magma and inferno, readable by everyone and in greyscale print;
  - **Classic**: grey, red, green, blue, cyan, magenta, yellow and orange;
  - **Intensity**: Fire and inverted grey;
  - **From file**: shown when the image file carries an ImageJ LUT that matches none of these. Its exact table is kept in the project, and it stays available after you try another LUT.

  Use the arrow keys to move, Enter to choose and Escape to close. Channels are added together, as in an ImageJ composite.
- **▮ (calibration bar)**: adds a calibration bar for this channel next to the image (see below).
- **min / max**: the display range (as in ImageJ's *Brightness & Contrast*). Values below *min* are black; values at or above *max* are full colour. Drag the slider or type a number and press Enter.
  - Behind the two sliders is the **histogram** of the plane on screen (the current Z slice or projection), on a log scale so a few bright pixels still show. The shaded part is the display range.
  - The sliders cover the range of the data: 0 to 255 for 8-bit images; for 16-bit files, the bits the data actually uses, so a 12-bit camera image gets 0 to 4095. You can still type any value the file can hold.
- **Auto**: sets *min* and *max* as ImageJ's *Auto* button and *Enhance Contrast* (saturated 0.35 %) do: 0.175 % of the pixels become black and 0.175 % full colour, so a few hot pixels do not squash the image. It gives the same values as ImageJ.
- **Full range**: shows the whole range of the data type, for example 0 to 4095 for 12-bit data.
- **Reset to file**: goes back to the range stored in the file (ImageJ's display range), or the one FluoForge chose on import when the file has none.

  Each of the three buttons is one undo step and applies to every selected image, each using its own pixels.
- **gamma** (0.1 to 5, default 1): bends the display between *min* and *max*. Above 1 the dim parts get darker, below 1 they get brighter. Like *min* and *max*, it only changes how the channel is shown, never the data; report it in your figure legend when it is not 1.
- **invert**: shows the channel inverted, bright as dark (like *Invert LUT* in Fiji).

**Calibration bar.** The ▮ button on a channel adds a bar showing that channel's colour table from its *min* (bottom) to its *max* (top), with the two values as labels. It stays linked to the channel: change the range, the LUT, the gamma or invert, and the bar follows. Move and resize it like any object; it is saved with the project and exported with the frame and labels as vectors and the gradient as a small image. Add one whenever the colours stand for intensities (viridis, Fire…), so readers can read the values.

Below the channels:

- **Pixel size (µm/px)**: read from the TIFF when available. Type a value to calibrate an image that has none; scale bars need it.
- **Image info**: opens a dialog with what FluoForge found in the selected image's file: format, dimensions, bit depth, channels (colour, display range and where that range came from), Z slices, time frames and Z step, pixel size and where it came from (the file or typed by hand), and the raw ImageJ header. Press Escape or **Close** to close it.
- **Preserve transparency (alpha)**: only for PNGs with transparent areas.
- **Brightness / Contrast**: a tone curve applied to the whole composite. **Reset** sets both to 0.

**Copying display settings.** To give other images exactly the look of one image, select that image and click **Copy display** in the selection bar (or right-click it and choose **Copy display settings**). Then select the other images and click **Paste display** (or right-click → **Paste display settings**). Each channel gets the copied LUT, *min*, *max*, gamma, invert and on/off, matched by number: channel 1 to channel 1, and so on. Brightness and contrast are copied too; channel names are not. When the images have different numbers of channels, the extra channels are left as they were. A paste is one undo step. With the keyboard, select an image and press the Menu key or Shift+F10 to open the same menu.

**Comparison groups.** When images must be compared (control versus treated, for example), their display has to stay the same. Select them and click **Link** in the selection bar: they become a *comparison group* and take the range (*min*, *max*), LUT and gamma of the first image, channel by number. From then on, changing one of these on any image of the group changes it on all of them, as one undo step: the sliders, typed values, the LUT, gamma, **Auto**, **Full range** and **Reset to file**. On/off, invert, channel names, brightness and contrast stay per image. The Channels panel names the group above the channels, and the Layers panel shows a chain icon on each of its images.

A paste of display settings onto one image of a group is not passed on, so the group can end up with different settings. Its images then show a ⚠ badge in the Layers panel, and the Channels panel says which channels differ. Click the badge, or **Match group to this image**, to give the whole group that image's settings again. **Unlink** takes the selected images out of their group; a group left with one image ends. Groups are saved with the project.

**Editing several images at once.** With several images selected, the panel edits all of them: a change to channel 2's colour, for example, is applied to channel 2 of every selected image. Only the setting you change is copied; the other settings stay as they were. Use this to give every panel of a figure the same display range, which keeps intensities comparable between conditions.

## 5. Z stacks and time series

TIFFs saved by ImageJ/Fiji as hyperstacks, and OME-TIFFs, open with their real channels: a stack with 4 channels and 5 Z slices shows 4 channels, not 20. When every slice of a channel has the same label in an ImageJ hyperstack, that label becomes the channel name. The Channels panel then shows the stack size and a **Z display** choice:

- **Maximum intensity projection** (default): each pixel shows its brightest value across the slices.
- **Mean intensity projection**: the average across the slices.
- **Single slice**: one optical section, chosen with the **slice** slider or by typing its number.

Time series also get a **frame** slider. Colours, display ranges and channel toggles apply to whichever plane is shown.

![A 4-channel, 5-slice Z stack shown as a maximum projection (left) and as slice 3 (selected, right), with the Z display controls in the Channels panel](images/14-zstack.jpg)

Each image (and each inset) keeps its own Z display. The choice is listed in the History panel, saved with the project and used when exporting. TIFFs without an ImageJ header or OME-XML still open with one channel per page.

## 6. Laying out panels with the Grid tool

The usual layout of a fluorescence figure is single channels next to the merge, one row per condition. To build it:

1. Import each image once per panel you want (or use **Duplicate**, Ctrl+D), and set each copy's channels in the Channels panel.
2. Select the images in reading order (or select none to use every image), then click **Grid**.
3. Set **Rows**, **Columns**, **Cell width / height** (page pixels) and **Gap**, choose whether to add **Column headers** and **Row labels**, and click **Arrange**.

![A 2 × 5 grid of DAPI, ERG, EdU, CD31 and merge panels for two cohorts, with the Grid Layout panel](images/04-grid.jpg)

Each image is fitted into its cell without distortion. The headers and row labels are ordinary text boxes that you then edit (here: DAPI, ERG, EdU, CD31, Merge and Cohort 3 / Cohort 2). Locked images are left in place.

## 7. Selecting, moving, aligning and locking

Use the **Select** tool (`V`). Click an object to select it; Shift+click or drag a rectangle to select several.

- **Move**: drag the object, or nudge it with the arrow keys (1 px; Shift+arrow moves 10 px).
- **Snapping**: while you drag, an object snaps to the edges and centre lines of the pages and of the other objects, and a dashed pink guide shows the edge it snapped to (on screen only, never exported). Hold Alt to move freely. Which edges snap (left, centre, right, top, middle, bottom), the snap distance and the guides are set in [Preferences](#preferences).
- **Resize / rotate**: drag the handles. Hold Shift while rotating to snap to 45°.
- **Exact values**: type **X**, **Y**, **W**, **H** and the rotation **∠** in the selection bar (page pixels). With **Ratio** ticked, the height follows the width. **↺ 90° / ↻ 90°** rotate by a quarter turn.
- **Duplicate** (Ctrl+D), **Copy / Paste** (Ctrl+C / Ctrl+V), **Delete** (Delete or Backspace).

With two or more objects selected, the bar adds **Align** (left, centre, right, top, middle, bottom), **Distribute** (horizontally or vertically) and **Group** (Ctrl+G; Ctrl+Shift+G ungroups):

![Two insets selected: the selection bar shows their combined position and the Align, Distribute and Group buttons](images/10-selection-bar.jpg)

**Locks**

- **Lock position** (selection bar, or the crosshair icon in the Layers panel): the object cannot be moved, resized or rotated, but its channels, colours, text and style stay editable. Use it once the layout is final.
- **Layer lock** (padlock icon in the Layers panel): the object cannot be selected, edited or deleted at all.

Align, distribute and the grid leave locked objects where they are, and a selection containing a locked object cannot be dragged or grouped. Both locks are saved with the project and survive undo and redo.

**Editing several objects of one kind.** The Channels, Shape, Pen / Path, Inset outline, Text and Scale bar panels edit every selected object of their kind at once, and only the setting you change is copied.

## 8. Cropping an image

Select an image and choose **Crop** (`C`). Drag the blue handles, or type an exact **Width** and **Height** in pixels; **Square** keeps the crop square. Click **Apply Crop** (or **Cancel**).

![The Crop tool on an image, with a 700 × 520 px region and the Crop panel](images/12-crop.jpg)

Cropping is never destructive: the full image stays in the project. **Uncrop** in the selection bar restores the full frame.

## 9. Scale bars

Scale bars use the image's pixel size, so they stay correct when the panel is resized.

1. Choose **Scale bar** (`S`) and select the image (or several images) that should get a bar.
2. Set **Length (µm)**, **Thickness**, **Color**, **Show label**, **Corner** and **Margin** (% of the image).
3. A dashed preview appears on each selected image, and the panel tells you how long the bar will be on the page. Nothing is added yet.
4. Click **Attach to corner** (the reference image) or **Attach to corner on all selected images**.

![Scale bar preview (50 µm = 94.5 px) on the two Merge panels, with the Scale Bar panel](images/05-scalebar.jpg)

An attached bar follows its image when you move, resize or crop it. Selecting an existing bar (with any tool) shows its length in µm, its image, that image's pixel size and the bar's length in image and page pixels; changing a field then edits the selected bar(s). The Layers panel and the selection bar also show each bar's length.

## 10. Insets

An inset is a magnified view of a region of an image. It stays linked to an outline drawn on the source image.

1. Choose **Inset** (`I`), then drag on an image to draw the outline (**Square** or **Rectangle**; hold Shift for the other). While you drag, the panel shows the outline's size on the page, in source pixels and in µm.
2. Set the outline **colour**, **width** and **dash style**, and the **Inset magnification**. New insets are created at the outline size × magnification.
3. Click **Create inset**. The inset appears next to the image; move and resize it freely.

![An inset outline drawn on the Merge panel; the Inset panel shows its size (120 px on the page, 279 px of the source, 63.5 µm)](images/06-inset-outline.jpg)

Moving or resizing the *outline* later changes the region the inset shows, without moving the inset itself. An inset has its own channel settings, so you can, for example, show only two channels in the zoom.

**Insets of an exact size.** Tick **Exact outline size** and type a width and height (page pixels), then click on an image to place an outline of exactly that size. The fields remember the last outline, so insets on different images match. **Apply exact size to selected outline** resizes an existing outline.

## 11. Shapes

Choose **Shape** (`R`), pick **Box**, **Ellipse** or **Line**, and drag on the canvas, including on top of an image. Hold Shift (or choose **Square**) for a square or a circle. Set **Stroke color**, **Stroke width**, **Dash style** (solid, dashed, dotted, dash-dot, long dash) and an optional **Fill**. Selecting a shape shows the same panel, and its changes apply to every selected shape.

![A dashed white circle drawn around a cell in inset C, with the Shape panel](images/07-shapes.jpg)

The coloured frames around insets B and C are boxes drawn with this tool, in the same colours as the outlines.

New shapes and paths start with a yellow stroke. The colour pickers offer bright colours, pastels, darker shades and greys, plus the pure ImageJ channel colours (red, green, blue, magenta, cyan and yellow), so outlines can match a channel exactly.

## 12. Pen and paths (arrows, outlines)

Choose **Pen / Path** (`P`) to draw lines, arrows and free outlines.

- Click to add a straight node; click and drag to pull out Bézier handles for a curve. Straight and curved segments can be mixed.
- Double-click or press Enter to finish, and Escape to cancel. Clicking the first node closes the path.
- Shift constrains to 45° angles. Ctrl snaps to nearby nodes and object edges or centres.
- Style: colour, width, opacity, dash style, line cap and join, and an **arrow** at the start and/or end.

To change a path later, select it and click **Edit nodes**: drag nodes and handles, double-click a segment to insert a node, and use **Corner / Smooth**, **Delete node**, **Straight segment / Curve segment** and **Close path**. Hold Alt while dragging a smooth node's handle to break the symmetry. **Done editing** returns to normal selection.

![The arrow in inset B in node-editing mode, with its two nodes and the Pen / Path panel](images/08-pen-path.jpg)

## 13. Text and captions

Choose **Text** (`T`) and click where the label should go, including on top of an image, then type. Click an existing text box to edit it.

![The white EdU⁺ ERG⁺ label selected, with the Text panel](images/09-text.jpg)

- **Font, Size, Text color, Bold / Italic / Underline.** Liberation Sans, Liberation Serif and Liberation Mono are built in and embedded in PDF exports; change other fonts to one of these before exporting a PDF.
- **Box**: a text box has its own width and height, independent of the font size. Drag the side and top/bottom handles (or type W/H in the selection bar) to resize the box; corner handles scale the text itself. The **Size** field always shows the real font size.
- **Alignment**: left / centre / right, and **Top / Middle / Bottom** inside the box. **Center both** centres it both ways.
- **Box background** and **Box border** (with **Border width**) turn a text box into a caption or a label patch.
- **Styling part of the text**: double-click into the text, highlight some words, and use the controls (colour, bold…). This is how superscripts and coloured words are made.

![A caption box with a grey background and border, centred vertically](images/09b-text-box.jpg)

## 14. Cropping an image to a shape

To show an image inside a circle, an ellipse or any closed outline:

1. Draw a box, an ellipse (Shift for a circle) or a closed pen path over the image.
2. Select the image and the shape together. **Crop to shape** appears in the selection bar.

![An image and a circle selected together; the selection bar shows Crop to shape](images/13a-crop-to-shape-select.jpg)

3. Click **Crop to shape**. The image frame is cropped to the shape, and the shape becomes the image's clipping path. It moves, scales and rotates with the image and stays a true vector clip in SVG and PDF.

![Page 2: maximum projection, single slice and an image cropped to a circle](images/13b-crop-to-shape-result.jpg)

**Remove shape crop** (selection bar) gives the shape back as an editable shape and restores the image's previous frame.

## 15. Pages and document properties

A figure can have several pages of the same size. **+ Page** (top bar) or **Add page** (Document Properties) adds a page below the last one; the page menu next to it scrolls to a page. Objects can be dragged between pages, and scale bars and insets keep working across pages.

![Zoomed out: page 1 (the figure) and page 2 (Z stack and crop-to-shape examples)](images/15-pages.jpg)

<img src="images/16-document.png" alt="Document Properties panel" width="300" align="right">

Click **Document** (or open the **Document Properties** panel) to change:

- **Project name**, **Width**, **Height**, **Unit**, **DPI**: click **Apply**. The pixel size of the page at that DPI is shown below.
- **Add page / Remove last page** (removing a page that still has objects asks first).
- **Next version name**: an optional name for the next **Save As** version.
- The save status, and the time of the last browser recovery checkpoint.

<br clear="right">

## 16. Layers

The **Layers** panel lists every object, frontmost first. Click a name to select the object; the ▲ / ▼ arrows move it forward or backward.

<img src="images/11-layers-history.png" alt="Layers and History panels" width="300" align="right">

Each row has three toggles:

- **Eye**: show / hide (**Show all** / **Hide all** for every object).
- **Padlock**: layer lock (cannot be selected, moved, edited or deleted).
- **Crosshair**: position/size lock (cannot be moved, resized or rotated; channels, colours and text stay editable).

Images in a comparison group (section 4) show a chain icon after their name, and a ⚠ badge when the group's settings differ; click the badge to match the group to that image.

**Ungroup** splits a selected group.

<br clear="right">

## 17. Undo and the History panel

Every change is a step in the **History** panel, with a readable name and its time ("Added image1.tif", "Moved scale bar 50 µm", "Changed channels of 2 objects", "Changed Z plane of …", "Cropped image1.tif to shape"). Click a step to go back to it. Later steps stay listed for redo until you make a new change. **Undo / Redo** (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z) move one step at a time, and up to 200 steps are kept.

## 18. Saving, versions and recovery

- **Save Project** (Ctrl+S) writes a `.fluoforge` file containing the editable figure and one copy of every original image, so you can reopen it later and change anything. In Chrome and Edge you pick the file once and later saves overwrite it; other browsers download a new copy each time.
- **Save As** saves to a new file as a new version that keeps the earlier history.
- **What is in the file**: a `.fluoforge` file is a zip with `manifest.json`, one editable state per saved version under `versions/`, and one copy of every distinct original image under `sources/`. **Save Project** updates the current version; **Save As** adds a child version.
- **Versions** lists the versions stored in the project and lets you restore one.
- **Open project** opens a `.fluoforge` file. Projects saved by older FluoForge versions open too: `.mfcproj.zip` files (FluoForge up to 0.1.2) and the older `.mfcproj.json` and `.gz` formats (v0.18–v0.19). Saving such a project writes a `.fluoforge` file; a project that was opened from a file in Chrome or Edge keeps saving to that file until you use **Save As**. In v0.18–v0.19 projects, scale bars and groups are converted, and a scale bar's length is read from its label.
- **Converted projects keep their original.** The first time you save a project that had to be converted from an older format, the version you opened stays in the file unchanged and the converted figure is saved as a new version ("Updated by FluoForge …"). **Versions** lists both, so you can go back.
- **Projects from a newer FluoForge** open with the message "Saved by FluoForge v…; some content may not display": this version shows what it understands. Saving keeps everything else unchanged, so the newer version still finds it. Export is refused while the figure holds content this version cannot draw; export it with the newer version.
- **Storage**: below the recovery status, FluoForge shows how much browser storage it uses and how much is available. After the first recovery draft it asks the browser to keep this data (Firefox may ask you for permission; allowing it stops the browser from clearing drafts when space runs low). If the browser storage is full, the recovery status says so and drafts pause; your figure is not affected, so save it to a file. Drafts resume when space is freed.
- **Recovery**: while you work, the browser keeps recovery checkpoints. If the tab is closed or crashes, FluoForge offers to recover the draft the next time it opens (only when the draft is newer than your last save). Recovery drafts are not a replacement for saving, and they do not become project versions until you save.
- Closing or reloading the tab with unsaved changes asks for confirmation.

## 19. Exporting the figure

**Export** offers four formats, the **Export…** dialog, **Export panels (zip)** and a [figure report](#figure-report-methods-and-adjustments). The four format items export every page at the document resolution in one click.

<img src="images/17-export.png" alt="Export menu" width="560">

| Format | What you get | Use it for |
|---|---|---|
| **TIFF (flattened RGB)** | One RGB image per page, losslessly compressed (Deflate by default), with the DPI written in the file. | Journals that want raster figures. |
| **PNG** | One image per page, with the DPI written in the file. | Slides, the web, quick previews. |
| **SVG** | One file per page. Text, shapes, paths, arrows, scale bars and clip paths stay as vectors; each image is embedded (cropped) at the output resolution, never enlarged beyond its source pixels. | Final touches in Inkscape or Illustrator. |
| **PDF** | One PDF with one page per figure page; vectors stay vectors and the Liberation fonts are embedded. | Submission and sharing. |

Images are always re-composited from the original channel data at full resolution, never from the screen preview. A panel printed smaller than its source is averaged down from the source pixels; a panel printed larger keeps its source resolution and is never enlarged. Dashed outlines keep their dash lengths in Inkscape and when resized. Export files are named after the project (characters that are not allowed in file names are replaced), and multi-page SVG, TIFF and PNG exports add `_page-1`, `_page-2`, … Objects on the pasteboard (outside a page) are not exported.

### The Export dialog

**Export ▸ Export…** sets everything before exporting, and shows the [figure check](#checking-the-figure-before-export) summary (it never blocks an export):

- **Format**: TIFF, PNG, SVG or PDF.
- **Pages**: all, the page you are looking at, or a list such as `1-3, 5`. PDF puts them in one file; the others write one file per page.
- **Resolution (dpi)** for TIFF and PNG, from the document's. Above it, panels printed smaller than their source get more of their source pixels; no image is ever enlarged beyond its source.
- **Transparent background** for TIFF (RGB with alpha), PNG and SVG: the empty page is left transparent instead of white.
- **TIFF compression**: Deflate (smallest), LZW (for older software) or none. All three are lossless.
- **Include the figure report**: also saves `<figure>_report.md` and `<figure>_report.json`.

The dialog remembers your choices until you close the page.

### Exporting the panels

**Export ▸ Export panels (zip)** writes `<figure>_panels.zip` with, for every image panel on the pages:

- `<letter>_merge.png`: the panel's crop at source resolution, as displayed (channels, LUTs, ranges, gamma, invert, brightness and contrast);
- `<letter>_<channel>.png`: each shown channel alone in grey, through its own display range, gamma and invert.

The letter is the one- or two-letter label (`A`, `b`, `(c)`) nearest the panel's top-left corner; panels without one are named `panel-1`, `panel-2`, … Each PNG records the pixel size when it is set. The zip also holds `figure-report.json` and a `README.txt` describing each file. Crop-to-shape masks are not applied to these PNGs.

### Figure report (Methods and adjustments)

**Export ▸ Figure report…** lists, for every image panel on the pages (insets included, hidden objects and the pasteboard left out):

- the source file: name, SHA-256 checksum (the same one the project uses to store it), format, dimensions, channels, Z slices, time frames, bit depth, and pixel size with where it came from;
- the crop, in source pixels (and in µm when the pixel size is set), and the shape of a crop-to-shape mask;
- the Z projection (maximum or mean of all slices, or the single slice) and the time frame;
- every channel: name, whether it is shown, LUT, display minimum and maximum, gamma and invert;
- brightness and contrast, rotation and flip;
- the printed size in mm and the effective resolution: source pixels per printed inch, against the document DPI, and the size in pixels the export writes. A panel below the document DPI is flagged (exports never enlarge images, so such a panel prints with its own pixels).

The dialog shows a **Methods paragraph** built only from these values: click **Copy paragraph** and paste it into your manuscript, then check it. **Markdown**, **CSV** (one row per channel of each panel, for a spreadsheet) and **JSON** download the full report as `<figure name>_report.md`, `.csv` or `.json`. The report contains no date, so the same figure always gives the same report.

Exports carry the report with them: each **SVG** has the JSON of the panels on its page in a `<metadata id="fluoforge-report">` element, and a **PDF** has the JSON of the whole figure in its *Subject* document property (with the figure name as *Title* and FluoForge as *Creator*), so a figure file keeps its own provenance. File names in the report are as they were imported, so they can reveal how your files are named.

### Checking the figure before export

The **Check figure** panel in the Inspector reviews the figure every time it changes (click **Check now** to run it at once), and the top of the **Export** menu shows the same summary with a **Review** button. Nothing here blocks an export.

| Finding | Severity |
|---|---|
| An image has a pixel size but no scale bar, on it or on another panel of its row | Warning |
| An image has no pixel size | Info |
| Red and green are both shown in one merged panel (use magenta and green) | Warning |
| A panel has no text label near it, at the start of its row or above its column | Warning |
| Panels of a comparison group show a different range, LUT or gamma | Error |
| More than 1 % of a shown channel's pixels (in the panel's crop) are at or above its maximum, or at or below its minimum | Warning |
| A channel's gamma is not 1, or brightness or contrast is not 0: state it in the legend or Methods | Info |
| A panel is printed larger than its source pixels, or below 300 dpi | Warning |
| Text is smaller than 5 pt or larger than 8 pt at print size | Warning |
| An inset's outline on its source panel is hidden or deleted | Warning |
| An object is on the pasteboard and will not be exported | Info |

Errors come first, then warnings, then information. Click a finding to select its object (or every panel of a comparison group). The font and resolution limits come from the default preset for now; journal presets will set them.

To dismiss a finding for this project, click **Dismiss…**, type why (for example "printed at the journal's column width") and press Enter. Dismissed findings are listed under **Dismissed**, where **Restore** brings one back. They are saved with the project, follow undo and redo, and appear with their notes in the figure report.

## 20. Themes

**Theme** (top right) switches the interface between Light · Lavender, Light · Sage, Dark · Plum and Dark · Slate. It does not change the figure, and the choice is remembered in this browser.

![The Dark · Slate theme](images/20-dark-theme.jpg)

### Colour-vision and grey-scale preview

**Vision** (next to Theme) shows the canvas as people with a colour-vision deficiency see it: **Deuteranopia** (no green cones, the most common), **Protanopia** (no red cones) and **Tritanopia** (no blue cones), or in **Grey-scale**, as in a black-and-white print. Use it to check that red and green, or a LUT, can still be told apart.

It is a view only. The figure, the project, undo and the exports do not change, and the choice is not remembered: FluoForge always starts in normal colours. While a preview is on, a badge over the canvas says so; click its **Normal** button (or choose Normal) to turn it off. The simulations use the matrices of Machado, Oliveira and Fernandes (2009) at full severity; grey-scale uses relative luminance (Rec. 709).

### Preferences

**Preferences** (the sliders button in the top bar, next to Open project, or Ctrl+,) opens a window above the canvas and the panels. Changes apply at once.

| Section | Preference | Default |
|---|---|---|
| Snapping | Snap while dragging | On |
| | Snap to the page; snap to other objects | On; on |
| | Snap these edges: left, centre (the vertical centre line), right, top, middle (the horizontal centre line), bottom. Left, centre and right line up horizontally; top, middle and bottom vertically. Tick only *Top*, for example, to align tops and nothing else. | All |
| | Snap distance, in pixels on screen (the same at every zoom) | 8 |
| | Show snap guides | On |
| Text | Default font, size (document px) and colour of new text boxes | Liberation Sans, 24, black |

A preference is **global**: it is saved in this browser and used by every project. Tick **This project only** on a row to give the open project its own value: it overrides the global preference in this project only, is saved with the project and follows undo and redo, and the row shows the global value beside it. Untick it to go back to the global value. **Reset global preferences** sets every global value back to its default; values of the open project are kept.

## 21. Keyboard shortcuts

| Keys | Action |
|---|---|
| `V` | Select tool |
| `C` | Crop tool |
| `T` | Text tool |
| `S` | Scale bar tool |
| `R` | Shape tool |
| `P` | Pen / Path tool |
| `I` | Inset tool |
| `+` / `-` | Zoom in / out (around the selection) |
| Ctrl+, | Preferences |
| Alt (while dragging) | Move without snapping |
| `0` | Zoom to 100 % |
| Shift+2 | Fit the selection in the view |
| Ctrl + mouse wheel | Zoom around the selection or the cursor |
| Arrow keys / Shift+arrows | Nudge by 1 px / 10 px |
| Ctrl+Z | Undo |
| Ctrl+Y or Ctrl+Shift+Z | Redo |
| Ctrl+D | Duplicate |
| Ctrl+C / Ctrl+V | Copy / paste |
| Ctrl+G / Ctrl+Shift+G | Group / ungroup |
| Menu key or Shift+F10 | Image menu (copy and paste display settings) |
| Ctrl+S | Save project |
| Delete or Backspace | Delete the selection (locked objects are kept) |
| Shift (while drawing) | Square / circle; 45° for paths and rotation |
| Ctrl (Pen tool) | Snap to nodes and object edges |
| Alt (editing nodes) | Break a smooth node's handles |
| Enter / Escape (Pen tool) | Finish / cancel the path |

## 22. Tips and troubleshooting

- **A stack opens as many channels.** The file has no ImageJ hyperstack header (or its header does not match the number of pages). **Image info** shows the header and says when it does not match. In Fiji, use *Image ▸ Hyperstacks ▸ Stack to Hyperstack* and save as TIFF.
- **Checking what was read from a file.** Select the image and click **Image info** in the Channels panel. For more detail, open FluoForge with `?debug=1` at the end of the address (or run `localStorage.fluoforgeDebug = '1'` in the browser console and reload): the TIFF reader then prints everything it decodes to the console. Importing is silent otherwise.
- **No scale bar can be added.** The image has no pixel size. Type it in the Channels panel (**Pixel size (µm/px)**).
- **Comparing conditions.** Select all panels of one channel and set the same *min / max*: the multi-image edit copies only the value you change.
- **PDF text looks different.** Only the Liberation fonts are embedded in PDF; switch labels to Liberation Sans, Serif or Mono.
- **Large images feel slow.** The editor shows a reduced preview above 2048 px; exports still use the full resolution.
- **"needs about … of memory" when importing.** FluoForge estimates the memory an image needs (width × height × planes × bytes per sample) and asks before opening one that would exceed what the browser seems to have left. Opening it anyway may crash the tab: save first, or close other tabs.
- **"The image … inside this project is damaged".** Every image in a project is stored with a checksum, and this one no longer matches: the project file was damaged, for example by an incomplete copy. Open an earlier copy of the project.
- **A file cannot be imported.** The message says why, for example "is not a TIFF file" or "is damaged or incomplete" (often a file that was not fully copied or downloaded). Nothing is added to the figure. For a microscope format (CZI, LIF, ND2, ...), a BigTIFF or a sample type FluoForge does not read (such as 16-bit float), the message links to the Fiji conversion macro (see [Importing images](#3-importing-images)).
- **"Unexpected error" message.** Something went wrong inside FluoForge. The figure stays editable; save it, then use **Copy details** and paste the report into a bug report. **Dismiss** or Escape closes the message.
- **Lost work.** Reopen FluoForge in the same browser: a recovery prompt appears if a draft newer than your last save exists. Save projects regularly anyway: browser storage can be cleared.
