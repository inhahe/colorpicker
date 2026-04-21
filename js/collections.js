/**
 * collections.js — Standard color collections and saved colors management
 * Provides named color sets (CSS, X11, web-safe, etc.) and UI for saved colors strip.
 */

// ============================================================================
// Standard Color Collections
// ============================================================================

export const STANDARD_COLLECTIONS = {
  css: {
    id: 'css',
    name: 'CSS Named Colors',
    colors: [
      { name: 'AliceBlue', hex: '#F0F8FF' },
      { name: 'AntiqueWhite', hex: '#FAEBD7' },
      { name: 'Aqua', hex: '#00FFFF' },
      { name: 'Aquamarine', hex: '#7FFFD4' },
      { name: 'Azure', hex: '#F0FFFF' },
      { name: 'Beige', hex: '#F5F5DC' },
      { name: 'Bisque', hex: '#FFE4C4' },
      { name: 'Black', hex: '#000000' },
      { name: 'BlanchedAlmond', hex: '#FFEBCD' },
      { name: 'Blue', hex: '#0000FF' },
      { name: 'BlueViolet', hex: '#8A2BE2' },
      { name: 'Brown', hex: '#A52A2A' },
      { name: 'BurlyWood', hex: '#DEB887' },
      { name: 'CadetBlue', hex: '#5F9EA0' },
      { name: 'Chartreuse', hex: '#7FFF00' },
      { name: 'Chocolate', hex: '#D2691E' },
      { name: 'Coral', hex: '#FF7F50' },
      { name: 'CornflowerBlue', hex: '#6495ED' },
      { name: 'Cornsilk', hex: '#FFF8DC' },
      { name: 'Crimson', hex: '#DC143C' },
      { name: 'Cyan', hex: '#00FFFF' },
      { name: 'DarkBlue', hex: '#00008B' },
      { name: 'DarkCyan', hex: '#008B8B' },
      { name: 'DarkGoldenRod', hex: '#B8860B' },
      { name: 'DarkGray', hex: '#A9A9A9' },
      { name: 'DarkGreen', hex: '#006400' },
      { name: 'DarkKhaki', hex: '#BDB76B' },
      { name: 'DarkMagenta', hex: '#8B008B' },
      { name: 'DarkOliveGreen', hex: '#556B2F' },
      { name: 'DarkOrange', hex: '#FF8C00' },
      { name: 'DarkOrchid', hex: '#9932CC' },
      { name: 'DarkRed', hex: '#8B0000' },
      { name: 'DarkSalmon', hex: '#E9967A' },
      { name: 'DarkSeaGreen', hex: '#8FBC8F' },
      { name: 'DarkSlateBlue', hex: '#483D8B' },
      { name: 'DarkSlateGray', hex: '#2F4F4F' },
      { name: 'DarkTurquoise', hex: '#00CED1' },
      { name: 'DarkViolet', hex: '#9400D3' },
      { name: 'DeepPink', hex: '#FF1493' },
      { name: 'DeepSkyBlue', hex: '#00BFFF' },
      { name: 'DimGray', hex: '#696969' },
      { name: 'DodgerBlue', hex: '#1E90FF' },
      { name: 'FireBrick', hex: '#B22222' },
      { name: 'FloralWhite', hex: '#FFFAF0' },
      { name: 'ForestGreen', hex: '#228B22' },
      { name: 'Fuchsia', hex: '#FF00FF' },
      { name: 'Gainsboro', hex: '#DCDCDC' },
      { name: 'GhostWhite', hex: '#F8F8FF' },
      { name: 'Gold', hex: '#FFD700' },
      { name: 'GoldenRod', hex: '#DAA520' },
      { name: 'Gray', hex: '#808080' },
      { name: 'Green', hex: '#008000' },
      { name: 'GreenYellow', hex: '#ADFF2F' },
      { name: 'HoneyDew', hex: '#F0FFF0' },
      { name: 'HotPink', hex: '#FF69B4' },
      { name: 'IndianRed', hex: '#CD5C5C' },
      { name: 'Indigo', hex: '#4B0082' },
      { name: 'Ivory', hex: '#FFFFF0' },
      { name: 'Khaki', hex: '#F0E68C' },
      { name: 'Lavender', hex: '#E6E6FA' },
      { name: 'LavenderBlush', hex: '#FFF0F5' },
      { name: 'LawnGreen', hex: '#7CFC00' },
      { name: 'LemonChiffon', hex: '#FFFACD' },
      { name: 'LightBlue', hex: '#ADD8E6' },
      { name: 'LightCoral', hex: '#F08080' },
      { name: 'LightCyan', hex: '#E0FFFF' },
      { name: 'LightGoldenRodYellow', hex: '#FAFAD2' },
      { name: 'LightGray', hex: '#D3D3D3' },
      { name: 'LightGreen', hex: '#90EE90' },
      { name: 'LightPink', hex: '#FFB6C1' },
      { name: 'LightSalmon', hex: '#FFA07A' },
      { name: 'LightSeaGreen', hex: '#20B2AA' },
      { name: 'LightSkyBlue', hex: '#87CEFA' },
      { name: 'LightSlateGray', hex: '#778899' },
      { name: 'LightSteelBlue', hex: '#B0C4DE' },
      { name: 'LightYellow', hex: '#FFFFE0' },
      { name: 'Lime', hex: '#00FF00' },
      { name: 'LimeGreen', hex: '#32CD32' },
      { name: 'Linen', hex: '#FAF0E6' },
      { name: 'Magenta', hex: '#FF00FF' },
      { name: 'Maroon', hex: '#800000' },
      { name: 'MediumAquaMarine', hex: '#66CDAA' },
      { name: 'MediumBlue', hex: '#0000CD' },
      { name: 'MediumOrchid', hex: '#BA55D3' },
      { name: 'MediumPurple', hex: '#9370DB' },
      { name: 'MediumSeaGreen', hex: '#3CB371' },
      { name: 'MediumSlateBlue', hex: '#7B68EE' },
      { name: 'MediumSpringGreen', hex: '#00FA9A' },
      { name: 'MediumTurquoise', hex: '#48D1CC' },
      { name: 'MediumVioletRed', hex: '#C71585' },
      { name: 'MidnightBlue', hex: '#191970' },
      { name: 'MintCream', hex: '#F5FFFA' },
      { name: 'MistyRose', hex: '#FFE4E1' },
      { name: 'Moccasin', hex: '#FFE4B5' },
      { name: 'NavajoWhite', hex: '#FFDEAD' },
      { name: 'Navy', hex: '#000080' },
      { name: 'OldLace', hex: '#FDF5E6' },
      { name: 'Olive', hex: '#808000' },
      { name: 'OliveDrab', hex: '#6B8E23' },
      { name: 'Orange', hex: '#FFA500' },
      { name: 'OrangeRed', hex: '#FF4500' },
      { name: 'Orchid', hex: '#DA70D6' },
      { name: 'PaleGoldenRod', hex: '#EEE8AA' },
      { name: 'PaleGreen', hex: '#98FB98' },
      { name: 'PaleTurquoise', hex: '#AFEEEE' },
      { name: 'PaleVioletRed', hex: '#DB7093' },
      { name: 'PapayaWhip', hex: '#FFEFD5' },
      { name: 'PeachPuff', hex: '#FFDAB9' },
      { name: 'Peru', hex: '#CD853F' },
      { name: 'Pink', hex: '#FFC0CB' },
      { name: 'Plum', hex: '#DDA0DD' },
      { name: 'PowderBlue', hex: '#B0E0E6' },
      { name: 'Purple', hex: '#800080' },
      { name: 'RebeccaPurple', hex: '#663399' },
      { name: 'Red', hex: '#FF0000' },
      { name: 'RosyBrown', hex: '#BC8F8F' },
      { name: 'RoyalBlue', hex: '#4169E1' },
      { name: 'SaddleBrown', hex: '#8B4513' },
      { name: 'Salmon', hex: '#FA8072' },
      { name: 'SandyBrown', hex: '#F4A460' },
      { name: 'SeaGreen', hex: '#2E8B57' },
      { name: 'SeaShell', hex: '#FFF5EE' },
      { name: 'Sienna', hex: '#A0522D' },
      { name: 'Silver', hex: '#C0C0C0' },
      { name: 'SkyBlue', hex: '#87CEEB' },
      { name: 'SlateBlue', hex: '#6A5ACD' },
      { name: 'SlateGray', hex: '#708090' },
      { name: 'Snow', hex: '#FFFAFA' },
      { name: 'SpringGreen', hex: '#00FF7F' },
      { name: 'SteelBlue', hex: '#4682B4' },
      { name: 'Tan', hex: '#D2B48C' },
      { name: 'Teal', hex: '#008080' },
      { name: 'Thistle', hex: '#D8BFD8' },
      { name: 'Tomato', hex: '#FF6347' },
      { name: 'Turquoise', hex: '#40E0D0' },
      { name: 'Violet', hex: '#EE82EE' },
      { name: 'Wheat', hex: '#F5DEB3' },
      { name: 'White', hex: '#FFFFFF' },
      { name: 'WhiteSmoke', hex: '#F5F5F5' },
      { name: 'Yellow', hex: '#FFFF00' },
      { name: 'YellowGreen', hex: '#9ACD32' },
    ]
  },

  websafe: {
    id: 'websafe',
    name: 'Web-Safe (216)',
    colors: (() => {
      const colors = [];
      const vals = [0x00, 0x33, 0x66, 0x99, 0xCC, 0xFF];
      for (const r of vals)
        for (const g of vals)
          for (const b of vals)
            colors.push({
              name: `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`.toUpperCase(),
              hex: `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`.toUpperCase()
            });
      return colors;
    })()
  },

  material: {
    id: 'material',
    name: 'Material Design',
    colors: [
      // Red
      { name: 'Red 50', hex: '#FFEBEE' }, { name: 'Red 100', hex: '#FFCDD2' },
      { name: 'Red 200', hex: '#EF9A9A' }, { name: 'Red 300', hex: '#E57373' },
      { name: 'Red 400', hex: '#EF5350' }, { name: 'Red 500', hex: '#F44336' },
      { name: 'Red 600', hex: '#E53935' }, { name: 'Red 700', hex: '#D32F2F' },
      { name: 'Red 800', hex: '#C62828' }, { name: 'Red 900', hex: '#B71C1C' },
      // Pink
      { name: 'Pink 50', hex: '#FCE4EC' }, { name: 'Pink 100', hex: '#F8BBD0' },
      { name: 'Pink 200', hex: '#F48FB1' }, { name: 'Pink 300', hex: '#F06292' },
      { name: 'Pink 400', hex: '#EC407A' }, { name: 'Pink 500', hex: '#E91E63' },
      { name: 'Pink 600', hex: '#D81B60' }, { name: 'Pink 700', hex: '#C2185B' },
      { name: 'Pink 800', hex: '#AD1457' }, { name: 'Pink 900', hex: '#880E4F' },
      // Purple
      { name: 'Purple 50', hex: '#F3E5F5' }, { name: 'Purple 100', hex: '#E1BEE7' },
      { name: 'Purple 200', hex: '#CE93D8' }, { name: 'Purple 300', hex: '#BA68C8' },
      { name: 'Purple 400', hex: '#AB47BC' }, { name: 'Purple 500', hex: '#9C27B0' },
      { name: 'Purple 600', hex: '#8E24AA' }, { name: 'Purple 700', hex: '#7B1FA2' },
      { name: 'Purple 800', hex: '#6A1B9A' }, { name: 'Purple 900', hex: '#4A148C' },
      // Deep Purple
      { name: 'Deep Purple 50', hex: '#EDE7F6' }, { name: 'Deep Purple 100', hex: '#D1C4E9' },
      { name: 'Deep Purple 200', hex: '#B39DDB' }, { name: 'Deep Purple 300', hex: '#9575CD' },
      { name: 'Deep Purple 400', hex: '#7E57C2' }, { name: 'Deep Purple 500', hex: '#673AB7' },
      { name: 'Deep Purple 600', hex: '#5E35B1' }, { name: 'Deep Purple 700', hex: '#512DA8' },
      { name: 'Deep Purple 800', hex: '#4527A0' }, { name: 'Deep Purple 900', hex: '#311B92' },
      // Indigo
      { name: 'Indigo 50', hex: '#E8EAF6' }, { name: 'Indigo 100', hex: '#C5CAE9' },
      { name: 'Indigo 200', hex: '#9FA8DA' }, { name: 'Indigo 300', hex: '#7986CB' },
      { name: 'Indigo 400', hex: '#5C6BC0' }, { name: 'Indigo 500', hex: '#3F51B5' },
      { name: 'Indigo 600', hex: '#3949AB' }, { name: 'Indigo 700', hex: '#303F9F' },
      { name: 'Indigo 800', hex: '#283593' }, { name: 'Indigo 900', hex: '#1A237E' },
      // Blue
      { name: 'Blue 50', hex: '#E3F2FD' }, { name: 'Blue 100', hex: '#BBDEFB' },
      { name: 'Blue 200', hex: '#90CAF9' }, { name: 'Blue 300', hex: '#64B5F6' },
      { name: 'Blue 400', hex: '#42A5F5' }, { name: 'Blue 500', hex: '#2196F3' },
      { name: 'Blue 600', hex: '#1E88E5' }, { name: 'Blue 700', hex: '#1976D2' },
      { name: 'Blue 800', hex: '#1565C0' }, { name: 'Blue 900', hex: '#0D47A1' },
      // Light Blue
      { name: 'Light Blue 50', hex: '#E1F5FE' }, { name: 'Light Blue 100', hex: '#B3E5FC' },
      { name: 'Light Blue 200', hex: '#81D4FA' }, { name: 'Light Blue 300', hex: '#4FC3F7' },
      { name: 'Light Blue 400', hex: '#29B6F6' }, { name: 'Light Blue 500', hex: '#03A9F4' },
      { name: 'Light Blue 600', hex: '#039BE5' }, { name: 'Light Blue 700', hex: '#0288D1' },
      { name: 'Light Blue 800', hex: '#0277BD' }, { name: 'Light Blue 900', hex: '#01579B' },
      // Cyan
      { name: 'Cyan 50', hex: '#E0F7FA' }, { name: 'Cyan 100', hex: '#B2EBF2' },
      { name: 'Cyan 200', hex: '#80DEEA' }, { name: 'Cyan 300', hex: '#4DD0E1' },
      { name: 'Cyan 400', hex: '#26C6DA' }, { name: 'Cyan 500', hex: '#00BCD4' },
      { name: 'Cyan 600', hex: '#00ACC1' }, { name: 'Cyan 700', hex: '#0097A7' },
      { name: 'Cyan 800', hex: '#00838F' }, { name: 'Cyan 900', hex: '#006064' },
      // Teal
      { name: 'Teal 50', hex: '#E0F2F1' }, { name: 'Teal 100', hex: '#B2DFDB' },
      { name: 'Teal 200', hex: '#80CBC4' }, { name: 'Teal 300', hex: '#4DB6AC' },
      { name: 'Teal 400', hex: '#26A69A' }, { name: 'Teal 500', hex: '#009688' },
      { name: 'Teal 600', hex: '#00897B' }, { name: 'Teal 700', hex: '#00796B' },
      { name: 'Teal 800', hex: '#00695C' }, { name: 'Teal 900', hex: '#004D40' },
      // Green
      { name: 'Green 50', hex: '#E8F5E9' }, { name: 'Green 100', hex: '#C8E6C9' },
      { name: 'Green 200', hex: '#A5D6A7' }, { name: 'Green 300', hex: '#81C784' },
      { name: 'Green 400', hex: '#66BB6A' }, { name: 'Green 500', hex: '#4CAF50' },
      { name: 'Green 600', hex: '#43A047' }, { name: 'Green 700', hex: '#388E3C' },
      { name: 'Green 800', hex: '#2E7D32' }, { name: 'Green 900', hex: '#1B5E20' },
      // Light Green
      { name: 'Light Green 50', hex: '#F1F8E9' }, { name: 'Light Green 100', hex: '#DCEDC8' },
      { name: 'Light Green 200', hex: '#C5E1A5' }, { name: 'Light Green 300', hex: '#AED581' },
      { name: 'Light Green 400', hex: '#9CCC65' }, { name: 'Light Green 500', hex: '#8BC34A' },
      { name: 'Light Green 600', hex: '#7CB342' }, { name: 'Light Green 700', hex: '#689F38' },
      { name: 'Light Green 800', hex: '#558B2F' }, { name: 'Light Green 900', hex: '#33691E' },
      // Lime
      { name: 'Lime 50', hex: '#F9FBE7' }, { name: 'Lime 100', hex: '#F0F4C3' },
      { name: 'Lime 200', hex: '#E6EE9C' }, { name: 'Lime 300', hex: '#DCE775' },
      { name: 'Lime 400', hex: '#D4E157' }, { name: 'Lime 500', hex: '#CDDC39' },
      { name: 'Lime 600', hex: '#C0CA33' }, { name: 'Lime 700', hex: '#AFB42B' },
      { name: 'Lime 800', hex: '#9E9D24' }, { name: 'Lime 900', hex: '#827717' },
      // Yellow
      { name: 'Yellow 50', hex: '#FFFDE7' }, { name: 'Yellow 100', hex: '#FFF9C4' },
      { name: 'Yellow 200', hex: '#FFF59D' }, { name: 'Yellow 300', hex: '#FFF176' },
      { name: 'Yellow 400', hex: '#FFEE58' }, { name: 'Yellow 500', hex: '#FFEB3B' },
      { name: 'Yellow 600', hex: '#FDD835' }, { name: 'Yellow 700', hex: '#FBC02D' },
      { name: 'Yellow 800', hex: '#F9A825' }, { name: 'Yellow 900', hex: '#F57F17' },
      // Amber
      { name: 'Amber 50', hex: '#FFF8E1' }, { name: 'Amber 100', hex: '#FFECB3' },
      { name: 'Amber 200', hex: '#FFE082' }, { name: 'Amber 300', hex: '#FFD54F' },
      { name: 'Amber 400', hex: '#FFCA28' }, { name: 'Amber 500', hex: '#FFC107' },
      { name: 'Amber 600', hex: '#FFB300' }, { name: 'Amber 700', hex: '#FFA000' },
      { name: 'Amber 800', hex: '#FF8F00' }, { name: 'Amber 900', hex: '#FF6F00' },
      // Orange
      { name: 'Orange 50', hex: '#FFF3E0' }, { name: 'Orange 100', hex: '#FFE0B2' },
      { name: 'Orange 200', hex: '#FFCC80' }, { name: 'Orange 300', hex: '#FFB74D' },
      { name: 'Orange 400', hex: '#FFA726' }, { name: 'Orange 500', hex: '#FF9800' },
      { name: 'Orange 600', hex: '#FB8C00' }, { name: 'Orange 700', hex: '#F57C00' },
      { name: 'Orange 800', hex: '#EF6C00' }, { name: 'Orange 900', hex: '#E65100' },
      // Deep Orange
      { name: 'Deep Orange 50', hex: '#FBE9E7' }, { name: 'Deep Orange 100', hex: '#FFCCBC' },
      { name: 'Deep Orange 200', hex: '#FFAB91' }, { name: 'Deep Orange 300', hex: '#FF8A65' },
      { name: 'Deep Orange 400', hex: '#FF7043' }, { name: 'Deep Orange 500', hex: '#FF5722' },
      { name: 'Deep Orange 600', hex: '#F4511E' }, { name: 'Deep Orange 700', hex: '#E64A19' },
      { name: 'Deep Orange 800', hex: '#D84315' }, { name: 'Deep Orange 900', hex: '#BF360C' },
      // Brown
      { name: 'Brown 50', hex: '#EFEBE9' }, { name: 'Brown 100', hex: '#D7CCC8' },
      { name: 'Brown 200', hex: '#BCAAA4' }, { name: 'Brown 300', hex: '#A1887F' },
      { name: 'Brown 400', hex: '#8D6E63' }, { name: 'Brown 500', hex: '#795548' },
      { name: 'Brown 600', hex: '#6D4C41' }, { name: 'Brown 700', hex: '#5D4037' },
      { name: 'Brown 800', hex: '#4E342E' }, { name: 'Brown 900', hex: '#3E2723' },
      // Grey
      { name: 'Grey 50', hex: '#FAFAFA' }, { name: 'Grey 100', hex: '#F5F5F5' },
      { name: 'Grey 200', hex: '#EEEEEE' }, { name: 'Grey 300', hex: '#E0E0E0' },
      { name: 'Grey 400', hex: '#BDBDBD' }, { name: 'Grey 500', hex: '#9E9E9E' },
      { name: 'Grey 600', hex: '#757575' }, { name: 'Grey 700', hex: '#616161' },
      { name: 'Grey 800', hex: '#424242' }, { name: 'Grey 900', hex: '#212121' },
      // Blue Grey
      { name: 'Blue Grey 50', hex: '#ECEFF1' }, { name: 'Blue Grey 100', hex: '#CFD8DC' },
      { name: 'Blue Grey 200', hex: '#B0BEC5' }, { name: 'Blue Grey 300', hex: '#90A4AE' },
      { name: 'Blue Grey 400', hex: '#78909C' }, { name: 'Blue Grey 500', hex: '#607D8B' },
      { name: 'Blue Grey 600', hex: '#546E7A' }, { name: 'Blue Grey 700', hex: '#455A64' },
      { name: 'Blue Grey 800', hex: '#37474F' }, { name: 'Blue Grey 900', hex: '#263238' },
    ]
  },

  ral: {
    id: 'ral',
    name: 'RAL Classic (subset)',
    colors: [
      { name: 'RAL 1000 Green beige', hex: '#BEBD7F' },
      { name: 'RAL 1001 Beige', hex: '#C2B078' },
      { name: 'RAL 1002 Sand yellow', hex: '#C6A664' },
      { name: 'RAL 1003 Signal yellow', hex: '#E5BE01' },
      { name: 'RAL 1004 Golden yellow', hex: '#CDA434' },
      { name: 'RAL 1005 Honey yellow', hex: '#A98307' },
      { name: 'RAL 1006 Maize yellow', hex: '#E4A010' },
      { name: 'RAL 1007 Daffodil yellow', hex: '#DC9D00' },
      { name: 'RAL 1011 Brown beige', hex: '#8A6642' },
      { name: 'RAL 1012 Lemon yellow', hex: '#C7B446' },
      { name: 'RAL 1013 Oyster white', hex: '#EAE6CA' },
      { name: 'RAL 1014 Ivory', hex: '#E1CC4F' },
      { name: 'RAL 1015 Light ivory', hex: '#E6D690' },
      { name: 'RAL 1016 Sulfur yellow', hex: '#EDFF21' },
      { name: 'RAL 1017 Saffron yellow', hex: '#F5D033' },
      { name: 'RAL 1018 Zinc yellow', hex: '#F8F32B' },
      { name: 'RAL 1019 Grey beige', hex: '#9E9764' },
      { name: 'RAL 1020 Olive yellow', hex: '#999950' },
      { name: 'RAL 1021 Rape yellow', hex: '#F3DA0B' },
      { name: 'RAL 1023 Traffic yellow', hex: '#FAD201' },
      { name: 'RAL 1024 Ochre yellow', hex: '#AEA04B' },
      { name: 'RAL 1027 Curry', hex: '#9D9101' },
      { name: 'RAL 1028 Melon yellow', hex: '#F4A900' },
      { name: 'RAL 1033 Dahlia yellow', hex: '#F3A505' },
      { name: 'RAL 1034 Pastel yellow', hex: '#EFA94A' },
      { name: 'RAL 2000 Yellow orange', hex: '#ED760E' },
      { name: 'RAL 2001 Red orange', hex: '#C93C20' },
      { name: 'RAL 2002 Vermilion', hex: '#CB2821' },
      { name: 'RAL 2003 Pastel orange', hex: '#FF7514' },
      { name: 'RAL 2004 Pure orange', hex: '#F44611' },
      { name: 'RAL 2008 Bright red orange', hex: '#F05837' },
      { name: 'RAL 2009 Traffic orange', hex: '#F54021' },
      { name: 'RAL 2010 Signal orange', hex: '#D84B20' },
      { name: 'RAL 2011 Deep orange', hex: '#EC7C26' },
      { name: 'RAL 2012 Salmon orange', hex: '#E55137' },
      { name: 'RAL 3000 Flame red', hex: '#AF2B1E' },
      { name: 'RAL 3001 Signal red', hex: '#A52019' },
      { name: 'RAL 3002 Carmine red', hex: '#A2231D' },
      { name: 'RAL 3003 Ruby red', hex: '#9B111E' },
      { name: 'RAL 3004 Purple red', hex: '#75151E' },
      { name: 'RAL 3005 Wine red', hex: '#5E2129' },
      { name: 'RAL 3007 Black red', hex: '#412227' },
      { name: 'RAL 3012 Beige red', hex: '#C1876B' },
      { name: 'RAL 3013 Tomato red', hex: '#A12312' },
      { name: 'RAL 3014 Antique pink', hex: '#D36E70' },
      { name: 'RAL 3015 Light pink', hex: '#EA899A' },
      { name: 'RAL 3016 Coral red', hex: '#B32821' },
      { name: 'RAL 3017 Rose', hex: '#E63244' },
      { name: 'RAL 3018 Strawberry red', hex: '#D53032' },
      { name: 'RAL 3020 Traffic red', hex: '#CC0605' },
      { name: 'RAL 3022 Salmon pink', hex: '#D95030' },
      { name: 'RAL 3027 Raspberry red', hex: '#C51D34' },
      { name: 'RAL 3031 Orient red', hex: '#B32428' },
      { name: 'RAL 4001 Red lilac', hex: '#6D3461' },
      { name: 'RAL 4002 Red violet', hex: '#922B3E' },
      { name: 'RAL 4003 Heather violet', hex: '#DE4C8A' },
      { name: 'RAL 4004 Claret violet', hex: '#641C34' },
      { name: 'RAL 4005 Blue lilac', hex: '#6C4675' },
      { name: 'RAL 4006 Traffic purple', hex: '#A03472' },
      { name: 'RAL 4007 Purple violet', hex: '#4A192C' },
      { name: 'RAL 4008 Signal violet', hex: '#924E7D' },
      { name: 'RAL 4009 Pastel violet', hex: '#A18594' },
      { name: 'RAL 5000 Violet blue', hex: '#354D73' },
      { name: 'RAL 5001 Green blue', hex: '#1F3438' },
      { name: 'RAL 5002 Ultramarine blue', hex: '#20214F' },
      { name: 'RAL 5003 Sapphire blue', hex: '#1D1E33' },
      { name: 'RAL 5004 Black blue', hex: '#18171C' },
      { name: 'RAL 5005 Signal blue', hex: '#1E2460' },
      { name: 'RAL 5007 Brilliant blue', hex: '#3E5F8A' },
      { name: 'RAL 5008 Grey blue', hex: '#26252D' },
      { name: 'RAL 5009 Azure blue', hex: '#025669' },
      { name: 'RAL 5010 Gentian blue', hex: '#0E294B' },
      { name: 'RAL 5011 Steel blue', hex: '#231A24' },
      { name: 'RAL 5012 Light blue', hex: '#3B83BD' },
      { name: 'RAL 5013 Cobalt blue', hex: '#1E213D' },
      { name: 'RAL 5014 Pigeon blue', hex: '#606E8C' },
      { name: 'RAL 5015 Sky blue', hex: '#2271B3' },
      { name: 'RAL 5017 Traffic blue', hex: '#063971' },
      { name: 'RAL 5018 Turquoise blue', hex: '#3F888F' },
      { name: 'RAL 5019 Capri blue', hex: '#1B5583' },
      { name: 'RAL 5020 Ocean blue', hex: '#1D334A' },
      { name: 'RAL 5021 Water blue', hex: '#256D7B' },
      { name: 'RAL 5022 Night blue', hex: '#252850' },
      { name: 'RAL 5023 Distant blue', hex: '#49678D' },
      { name: 'RAL 5024 Pastel blue', hex: '#5D9B9B' },
      { name: 'RAL 6000 Patina green', hex: '#316650' },
      { name: 'RAL 6001 Emerald green', hex: '#287233' },
      { name: 'RAL 6002 Leaf green', hex: '#2D572C' },
      { name: 'RAL 6003 Olive green', hex: '#424632' },
      { name: 'RAL 6004 Blue green', hex: '#1F3A3D' },
      { name: 'RAL 6005 Moss green', hex: '#2F4538' },
      { name: 'RAL 6006 Grey olive', hex: '#3E3B32' },
      { name: 'RAL 6007 Bottle green', hex: '#343B29' },
      { name: 'RAL 6008 Brown green', hex: '#39352A' },
      { name: 'RAL 6009 Fir green', hex: '#31372B' },
      { name: 'RAL 6010 Grass green', hex: '#35682D' },
      { name: 'RAL 6011 Reseda green', hex: '#587246' },
      { name: 'RAL 6012 Black green', hex: '#343E40' },
      { name: 'RAL 6013 Reed green', hex: '#6C7156' },
      { name: 'RAL 6014 Yellow olive', hex: '#47402E' },
      { name: 'RAL 6015 Black olive', hex: '#3B3C36' },
      { name: 'RAL 6016 Turquoise green', hex: '#1E5945' },
      { name: 'RAL 6017 May green', hex: '#4C9141' },
      { name: 'RAL 6018 Yellow green', hex: '#57A639' },
      { name: 'RAL 6019 Pastel green', hex: '#BDECB6' },
      { name: 'RAL 6020 Chrome green', hex: '#2E3A23' },
      { name: 'RAL 6024 Traffic green', hex: '#308446' },
      { name: 'RAL 6025 Fern green', hex: '#3D642D' },
      { name: 'RAL 6026 Opal green', hex: '#015D52' },
      { name: 'RAL 6027 Light green', hex: '#84C3BE' },
      { name: 'RAL 6028 Pine green', hex: '#2C5545' },
      { name: 'RAL 6029 Mint green', hex: '#20603D' },
      { name: 'RAL 6032 Signal green', hex: '#317F43' },
      { name: 'RAL 6033 Mint turquoise', hex: '#497E76' },
      { name: 'RAL 6034 Pastel turquoise', hex: '#7FB5B5' },
      { name: 'RAL 7000 Squirrel grey', hex: '#78858B' },
      { name: 'RAL 7001 Silver grey', hex: '#8A9597' },
      { name: 'RAL 7002 Olive grey', hex: '#7E7B52' },
      { name: 'RAL 7003 Moss grey', hex: '#6C7059' },
      { name: 'RAL 7004 Signal grey', hex: '#969992' },
      { name: 'RAL 7005 Mouse grey', hex: '#646B63' },
      { name: 'RAL 7006 Beige grey', hex: '#6D6552' },
      { name: 'RAL 7008 Khaki grey', hex: '#6A5F31' },
      { name: 'RAL 7009 Green grey', hex: '#4D5645' },
      { name: 'RAL 7010 Tarpaulin grey', hex: '#4C514A' },
      { name: 'RAL 7011 Iron grey', hex: '#434B4D' },
      { name: 'RAL 7012 Basalt grey', hex: '#4E5754' },
      { name: 'RAL 7013 Brown grey', hex: '#464531' },
      { name: 'RAL 7015 Slate grey', hex: '#434750' },
      { name: 'RAL 7016 Anthracite grey', hex: '#293133' },
      { name: 'RAL 7021 Black grey', hex: '#23282B' },
      { name: 'RAL 7022 Umbra grey', hex: '#332F2C' },
      { name: 'RAL 7023 Concrete grey', hex: '#686C5E' },
      { name: 'RAL 7024 Graphite grey', hex: '#474A51' },
      { name: 'RAL 7026 Granite grey', hex: '#2F353B' },
      { name: 'RAL 7030 Stone grey', hex: '#8B8C7A' },
      { name: 'RAL 7031 Blue grey', hex: '#474B4E' },
      { name: 'RAL 7032 Pebble grey', hex: '#B8B799' },
      { name: 'RAL 7033 Cement grey', hex: '#7D8471' },
      { name: 'RAL 7034 Yellow grey', hex: '#8F8B66' },
      { name: 'RAL 7035 Light grey', hex: '#D7D7D7' },
      { name: 'RAL 7036 Platinum grey', hex: '#7F7679' },
      { name: 'RAL 7037 Dusty grey', hex: '#7D7F7D' },
      { name: 'RAL 7038 Agate grey', hex: '#B5B8B1' },
      { name: 'RAL 7039 Quartz grey', hex: '#6C6960' },
      { name: 'RAL 7040 Window grey', hex: '#9DA1AA' },
      { name: 'RAL 7042 Traffic grey A', hex: '#8D948D' },
      { name: 'RAL 7043 Traffic grey B', hex: '#4E5452' },
      { name: 'RAL 7044 Silk grey', hex: '#CAC4B0' },
      { name: 'RAL 7045 Telegrey 1', hex: '#909090' },
      { name: 'RAL 7046 Telegrey 2', hex: '#82898F' },
      { name: 'RAL 7047 Telegrey 4', hex: '#D0D0D0' },
      { name: 'RAL 8000 Green brown', hex: '#826C34' },
      { name: 'RAL 8001 Ochre brown', hex: '#955F20' },
      { name: 'RAL 8002 Signal brown', hex: '#6C3B2A' },
      { name: 'RAL 8003 Clay brown', hex: '#734222' },
      { name: 'RAL 8004 Copper brown', hex: '#8E402A' },
      { name: 'RAL 8007 Fawn brown', hex: '#59351F' },
      { name: 'RAL 8008 Olive brown', hex: '#6F4F28' },
      { name: 'RAL 8011 Nut brown', hex: '#5B3A29' },
      { name: 'RAL 8012 Red brown', hex: '#592321' },
      { name: 'RAL 8014 Sepia brown', hex: '#382C1E' },
      { name: 'RAL 8015 Chestnut brown', hex: '#633A34' },
      { name: 'RAL 8016 Mahogany brown', hex: '#4C2F27' },
      { name: 'RAL 8017 Chocolate brown', hex: '#45322E' },
      { name: 'RAL 8019 Grey brown', hex: '#403A3A' },
      { name: 'RAL 8022 Black brown', hex: '#212121' },
      { name: 'RAL 8023 Orange brown', hex: '#A65E2E' },
      { name: 'RAL 8024 Beige brown', hex: '#79553D' },
      { name: 'RAL 8025 Pale brown', hex: '#755C48' },
      { name: 'RAL 8028 Terra brown', hex: '#4E3B31' },
      { name: 'RAL 9001 Cream', hex: '#FDF4E3' },
      { name: 'RAL 9002 Grey white', hex: '#E7EBDA' },
      { name: 'RAL 9003 Signal white', hex: '#F4F4F4' },
      { name: 'RAL 9004 Signal black', hex: '#282828' },
      { name: 'RAL 9005 Jet black', hex: '#0A0A0A' },
      { name: 'RAL 9010 Pure white', hex: '#FFFFFF' },
      { name: 'RAL 9011 Graphite black', hex: '#1C1C1C' },
      { name: 'RAL 9016 Traffic white', hex: '#F6F6F6' },
      { name: 'RAL 9017 Traffic black', hex: '#1E1E1E' },
      { name: 'RAL 9018 Papyrus white', hex: '#D7D7D7' },
    ]
  },

  pastel: {
    id: 'pastel',
    name: 'Pastels',
    colors: [
      { name: 'Pastel Pink', hex: '#FFD1DC' },
      { name: 'Pastel Salmon', hex: '#FFA07A' },
      { name: 'Pastel Red', hex: '#FF6961' },
      { name: 'Pastel Orange', hex: '#FFB347' },
      { name: 'Pastel Peach', hex: '#FFDAB9' },
      { name: 'Pastel Yellow', hex: '#FDFD96' },
      { name: 'Pastel Lime', hex: '#B2FBA5' },
      { name: 'Pastel Green', hex: '#77DD77' },
      { name: 'Pastel Mint', hex: '#AAF0D1' },
      { name: 'Pastel Teal', hex: '#99E6B3' },
      { name: 'Pastel Cyan', hex: '#B2FFFF' },
      { name: 'Pastel Sky', hex: '#89CFF0' },
      { name: 'Pastel Blue', hex: '#AEC6CF' },
      { name: 'Pastel Indigo', hex: '#B39EB5' },
      { name: 'Pastel Lavender', hex: '#C3B1E1' },
      { name: 'Pastel Purple', hex: '#B19CD9' },
      { name: 'Pastel Violet', hex: '#CB99C9' },
      { name: 'Pastel Magenta', hex: '#FF77FF' },
      { name: 'Pastel Rose', hex: '#FFB7CE' },
      { name: 'Pastel Coral', hex: '#F88379' },
      { name: 'Pastel Mauve', hex: '#E0B0FF' },
      { name: 'Pastel Lilac', hex: '#DCD0FF' },
      { name: 'Pastel Periwinkle', hex: '#CCCCFF' },
      { name: 'Pastel Brown', hex: '#C4A882' },
    ]
  },

  spectrum: {
    id: 'spectrum',
    name: 'Visible Spectrum',
    colors: (() => {
      // Generate spectrum colors from 380nm to 780nm
      const colors = [];
      for (let wl = 380; wl <= 780; wl += 5) {
        let r, g, b;
        if (wl >= 380 && wl < 440) {
          r = -(wl - 440) / (440 - 380);
          g = 0;
          b = 1;
        } else if (wl >= 440 && wl < 490) {
          r = 0;
          g = (wl - 440) / (490 - 440);
          b = 1;
        } else if (wl >= 490 && wl < 510) {
          r = 0;
          g = 1;
          b = -(wl - 510) / (510 - 490);
        } else if (wl >= 510 && wl < 580) {
          r = (wl - 510) / (580 - 510);
          g = 1;
          b = 0;
        } else if (wl >= 580 && wl < 645) {
          r = 1;
          g = -(wl - 645) / (645 - 580);
          b = 0;
        } else {
          r = 1;
          g = 0;
          b = 0;
        }
        // Intensity correction at edges
        let factor;
        if (wl >= 380 && wl < 420) factor = 0.3 + 0.7 * (wl - 380) / (420 - 380);
        else if (wl >= 700) factor = 0.3 + 0.7 * (780 - wl) / (780 - 700);
        else factor = 1.0;
        r = Math.round(255 * Math.pow(r * factor, 0.8));
        g = Math.round(255 * Math.pow(g * factor, 0.8));
        b = Math.round(255 * Math.pow(b * factor, 0.8));
        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));
        const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
        colors.push({ name: `${wl}nm`, hex });
      }
      return colors;
    })()
  },

  grayscale: {
    id: 'grayscale',
    name: 'Grayscale (32 steps)',
    colors: (() => {
      const colors = [];
      for (let i = 0; i < 32; i++) {
        const v = Math.round((i / 31) * 255);
        const hex = '#' + v.toString(16).padStart(2, '0').repeat(3).toUpperCase();
        colors.push({ name: `Gray ${Math.round((i / 31) * 100)}%`, hex });
      }
      return colors;
    })()
  },
};

// ============================================================================
// Saved Colors UI Manager
// ============================================================================

export class SavedColorsUI {
  /**
   * @param {HTMLElement} stripContainer - the #saved-colors-strip element
   * @param {HTMLElement} saveButton - the #btn-save-color element
   * @param {import('./state.js').AppState} state
   * @param {import('./color-engine.js').ColorEngine} engine
   * @param {Function} onColorSelect - callback when a saved color is clicked
   */
  constructor(stripContainer, saveButton, state, engine, onColorSelect) {
    this.strip = stripContainer;
    this.saveBtn = saveButton;
    this.state = state;
    this.engine = engine;
    this.onColorSelect = onColorSelect;

    this._dragIdx = null;
    this._dragOverIdx = null;

    this.saveBtn.addEventListener('click', () => this._saveCurrentColor());
    this.state.subscribe('savedColors', () => this.render());
    this.render();
  }

  _saveCurrentColor() {
    const color = this.state.get('currentColor');
    if (!color) return;
    this.state.addSavedColor({
      sourceSpace: color.sourceSpace,
      sourceValues: [...color.sourceValues],
      xyz: [...color.xyz],
      name: null,
      timestamp: Date.now(),
    });
  }

  render() {
    const saved = this.state.get('savedColors') || [];
    this.strip.innerHTML = '';

    saved.forEach((color, idx) => {
      const swatch = document.createElement('div');
      swatch.className = 'saved-swatch';
      swatch.draggable = true;

      // Compute display color
      let hex;
      try {
        hex = this.engine.toHex(color.sourceValues, color.sourceSpace);
      } catch {
        hex = '#888888';
      }
      swatch.style.backgroundColor = hex;

      // Tooltip
      const name = color.name || hex;
      swatch.title = name;

      // Click to select
      swatch.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+click to remove
          this.state.removeSavedColor(idx);
        } else {
          this.onColorSelect(color);
        }
      });

      // Right-click context menu
      swatch.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContextMenu(e, idx, color, hex);
      });

      // Drag and drop for reordering
      swatch.addEventListener('dragstart', (e) => {
        this._dragIdx = idx;
        swatch.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', hex);
        e.dataTransfer.setData('application/x-color-index', String(idx));
      });
      swatch.addEventListener('dragend', () => {
        swatch.classList.remove('dragging');
        this._dragIdx = null;
        this._dragOverIdx = null;
        this.strip.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
      swatch.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (this._dragIdx !== null && this._dragIdx !== idx) {
          this.strip.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
          swatch.classList.add('drag-over');
          this._dragOverIdx = idx;
        }
      });
      swatch.addEventListener('drop', (e) => {
        e.preventDefault();
        swatch.classList.remove('drag-over');
        if (this._dragIdx !== null && this._dragIdx !== idx) {
          this.state.reorderSavedColor(this._dragIdx, idx);
        }
      });

      this.strip.appendChild(swatch);
    });

    // Show empty state
    if (saved.length === 0) {
      const hint = document.createElement('span');
      hint.className = 'saved-empty-hint';
      hint.textContent = 'Click "+ Save" to save the current color';
      this.strip.appendChild(hint);
    }
  }

  _showContextMenu(event, index, color, hex) {
    // Remove existing context menu
    const existing = document.querySelector('.color-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'color-context-menu';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';

    const items = [
      { label: 'Use this color', action: () => this.onColorSelect(color) },
      { label: `Copy hex (${hex})`, action: () => navigator.clipboard?.writeText(hex) },
      { label: 'Rename...', action: () => this._rename(index) },
      { label: 'Delete', action: () => this.state.removeSavedColor(index), danger: true },
    ];

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'context-menu-item' + (item.danger ? ' danger' : '');
      el.textContent = item.label;
      el.addEventListener('click', () => {
        menu.remove();
        item.action();
      });
      menu.appendChild(el);
    }

    document.body.appendChild(menu);
    // Close on outside click
    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('mousedown', close);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  _rename(index) {
    const saved = this.state.get('savedColors');
    const color = saved[index];
    const newName = prompt('Enter color name:', color.name || '');
    if (newName !== null) {
      const updated = [...saved];
      updated[index] = { ...color, name: newName || null };
      this.state.set('savedColors', updated);
    }
  }
}

// ============================================================================
// Standard Collections UI Manager
// ============================================================================

export class CollectionsUI {
  /**
   * @param {HTMLSelectElement} selectEl - the #collection-select element
   * @param {HTMLElement} colorsContainer - the #collection-colors element
   * @param {Function} onColorSelect - callback when a collection color is clicked
   */
  constructor(selectEl, colorsContainer, onColorSelect) {
    this.select = selectEl;
    this.container = colorsContainer;
    this.onColorSelect = onColorSelect;

    // Populate dropdown
    for (const [id, collection] of Object.entries(STANDARD_COLLECTIONS)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${collection.name} (${collection.colors.length})`;
      this.select.appendChild(opt);
    }

    this.select.addEventListener('change', () => this._renderCollection());
  }

  _renderCollection() {
    const id = this.select.value;
    this.container.innerHTML = '';
    if (!id || !STANDARD_COLLECTIONS[id]) return;

    const collection = STANDARD_COLLECTIONS[id];
    for (const color of collection.colors) {
      const swatch = document.createElement('div');
      swatch.className = 'collection-swatch';
      swatch.style.backgroundColor = color.hex;
      swatch.title = `${color.name}\n${color.hex}`;
      swatch.draggable = true;

      swatch.addEventListener('click', () => {
        this.onColorSelect({
          sourceSpace: 'srgb',
          sourceValues: hexToRGB(color.hex),
          name: color.name,
        });
      });

      swatch.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', color.hex);
        e.dataTransfer.setData('application/x-color-name', color.name);
      });

      this.container.appendChild(swatch);
    }
  }

  showCollection(id) {
    this.select.value = id;
    this._renderCollection();
  }
}

// ============================================================================
// Helpers
// ============================================================================

function hexToRGB(hex) {
  hex = hex.replace('#', '');
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16),
  ];
}
