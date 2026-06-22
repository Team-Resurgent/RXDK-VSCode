//
// Common code
//
var ie4 = false;
var advanced = false;
var curLang = null;
var showAll = true;
var cook = null;
var baseUrl = document.scripts[document.scripts.length - 1].src.replace(/[^\/]+.js/, "");

var isIE5= (navigator.appVersion.indexOf("MSIE 5")>0) || (navigator.appVersion.indexOf("MSIE")>0 && parseInt(navigator.appVersion)> 4);

//added for checklist persist.
var isPersistent= false;
window.onunload=saveChecklistState;

//hacks
var hhobj_1 = new Hack;
var hhobj_2 = new Hack;
var hhobj_3 = new Hack;
var hhobj_4 = new Hack;
var hhobj_5 = new Hack;
var hhobj_6 = new Hack;
var hhobj_7 = new Hack;
var hhobj_8 = new Hack;
var hhobj_9 = new Hack;
var hhobj_10 = new Hack;
var hhobj_11 = new Hack;
var hhobj_12 = new Hack;

if (navigator.appName == "Microsoft Internet Explorer") {
	var ver = navigator.appVersion;
	var v = new Number(ver.substring(0,ver.indexOf(".", 0)));
	if (v >= 4) {
		advanced = true;
		ie4 = true;

		// Look for 5.x buried somewhere in the version string.
		var toks = ver.split(/[^0-9.]/);
		if (toks) {
			for (var i = 0; i < toks.length; i++) {
				var tok = toks[i];
				if (tok.indexOf(".", 0) > 0) {
					if (tok >= 5)
						ie4 = false;
				}
			}
		}
	}
}

//if (advanced)
//	window.onload = bodyOnLoad;

window.onload = SetFooter;

function SetFooter()
{
	var TITLEs = document.all.tags("TITLE");

	var sTitle;
	if (!TITLEs)
		sTitle="No Title";
	else
		sTitle = TITLEs(0).innerHTML;

	var sSubject = "Doc feedback on page:" + sTitle;
	var sHelp = "<br><p class='special' style='text-align:center; margin-top:0; margin-bottom:0;'>" + 
		"<a href='mailto:xboxds@xbox.com?subject=" + sSubject + "'>Send feedback on this page</a>" +
		"</p><br>";
// **** DO NOT EDIT THIS LINE. THE BUILD SCRIPT USES IT ****
document.all["footer"].innerHTML = sHelp + "Built on Thursday, January 20, 2005. Build #5849.<BR><BR><a href='xbox_legal.htm' style='text-decoration:none;'>Unpublished work. &#169 2000-2003 Microsoft Corporation.  All rights reserved.</a>";

	if (advanced){
		bodyOnLoad();
	}
}

//Hack - pseudo object	
function Hack()
{

}

//Hack.Click - pseudo method
Hack.prototype.Click = function()
{	
	window.navigate("notopic_0pk4.htm");
}

function bodyOnClick()
{
	if (advanced) {
		var elem = window.event.srcElement;
		for (; elem; elem = elem.parentElement) {
			if (elem.id == "reftip")
				return;
		}

		hideTip();
		closeMenu();
		hideSeeAlso();
	}
}

function bodyOnLoad()
{
	if (advanced) {
		initLangs();
		initReftips();
		initSeeAlso();
		initFeedback();
		document.body.onclick = bodyOnClick;
		window.onresize = moveFeedback;
		window.onunload=saveChecklistState;
	}
//Added for checklist state
isPersistent= (document.all.item("checklist")!=null) && (isIE5);
  if (isPersistent) getChecklistState();

}

//
// Language filtering
//
function initLangs()
{
	var hdr = document.all.hdr;
	if (!hdr)
		return;

	var langs = new Array;
	var spans = document.all.tags("SPAN");
	if (spans) {
		var iElem = spans.length;
		for (iElem = 0; iElem < spans.length; iElem++) {
			var elem = spans[iElem];
			if (elem.className == "lang") {

				// Update the array of unique language names.
				var a = elem.innerText.split(",");
				for (var iTok = 0; iTok < a.length; iTok++) {
					var m = a[iTok].match(/([A-Za-z].*[A-Za-z+])/);
					if (m) {
						var iLang = 0;
						while (iLang < langs.length && langs[iLang] < m[1])
							iLang++;
						if (iLang == langs.length || langs[iLang] != m[1]) {
							var before = langs.slice(0,iLang);
							var after = langs.slice(iLang);
							langs = before.concat(m[1]).concat(after);
						}
					}
				}
			}
		}
	}

	if (langs.length > 0) {
		var pres = document.all.tags("PRE");
		if (pres) {
			for (var iPre = 0; iPre < pres.length; iPre++)
				initPreElem(pres[iPre]);
		}

		var obj = document.all.obj_cook;
		if (obj && obj.object) {
			cook = obj;
			var lang = obj.getValue("lang");
			var iLang = langs.length - 1;
			while (iLang && langs[iLang] != lang)
				iLang--;
			curLang = langs[iLang];
			if (obj.getValue("lang.all") != "1")
				showAll = false;
		}

		var iLim = document.body.children.length;
		var head = null;
		for (var i = 0; i < iLim; i++) {
			var elem = document.body.children[i];
			if (elem.tagName.match(/^(P)|(PRE)|([DOU]L)$/))
				break;
			if (elem.tagName.match(/^H[1-6]$/)) {
				head = elem;

/******** This line inserts the lang next to the head of the topic *************
				head.insertAdjacentHTML('BeforeEnd', '<SPAN CLASS=ilang></SPAN>');
*/
			}
		}

/******** Disabled dropdown menu for lang filtering *****************/
/*
		var td = hdr.insertCell(0);


		if (td) {
			// Localizable strings.
			var L_Filter_Tip = "Language Filtering";	// tooltip for language button
			var L_Language = "Language";				// heading for menu of programming languages
			var L_Show_All = "Show All";				// label for 'show all languages' menu item

			// Add the language button to the button bar.
			td.className = "button1";
			td.style.width = "19px";
			td.onclick = langMenu;
			td.innerHTML = '<IMG SRC="' + baseUrl + 'filter.gif' + '" ALT="' +
				L_Filter_Tip + '" BORDER=0>';

			// Add the menu.
			var div = '<DIV ID="lang_menu" CLASS=langMenu><B>' + L_Language + '</B><UL>';
			for (var i = 0; i < langs.length; i++)
				div += '<LI><A HREF="" ONCLICK="chooseLang(this)">' + langs[i] + '</A><BR>';
			div += '<LI><A HREF="" ONCLICK="chooseAll()">' + L_Show_All + '</A></UL></DIV>';
			document.body.insertAdjacentHTML('BeforeEnd', div);
		}
*/
		if (!showAll)
			filterLang();
	}
}

function initPreElem(pre)
{
	var htm0 = pre.outerHTML;

	var reLang = /<span\b[^>]*class="?lang"?[^>]*>/i;
	var iFirst = -1;
	var iSecond = -1;

	iFirst = htm0.search(reLang);
	if (iFirst >= 0) {
		iPos = iFirst + 17;
		iMatch = htm0.substr(iPos).search(reLang);
		if (iMatch >= 0)
			iSecond = iPos + iMatch;
	}

	if (iSecond < 0) {
		var htm1 = trimPreElem(htm0);
		if (htm1 != htm0) {
			pre.insertAdjacentHTML('AfterEnd', htm1);
			pre.outerHTML = "";
		}
	}
	else {
		var rePairs = /<(\w+)\b[^>]*><\/\1>/gi;

		var substr1 = htm0.substring(0,iSecond);
		var tags1 = substr1.replace(/>[^<>]+(<|$)/g, ">$1");
		var open1 = tags1.replace(rePairs, "");
		open1 = open1.replace(rePairs, "");

		var substr2 = htm0.substring(iSecond);
		var tags2 = substr2.replace(/>[^<>]+</g, "><");
		var open2 = tags2.replace(rePairs, "");
		open2 = open2.replace(rePairs, "");

		pre.insertAdjacentHTML('AfterEnd', open1 + substr2);
		pre.insertAdjacentHTML('AfterEnd', trimPreElem(substr1 + open2));
		pre.outerHTML = "";
	}	
}

function trimPreElem(htm)
{
	return htm.replace(/[ \r\n]*((<\/[BI]>)*)[ \r\n]*<\/PRE>/g, "$1</PRE>").replace(
		/\w*<\/SPAN>\w*((<[BI]>)*)\w*\r\n/g, "\r\n</SPAN>$1"
		);
}

function getBlock(elem)
{
	while (elem && elem.tagName.match(/^[BIUA]|(SPAN)|(CODE)|(TD)$/))
		elem = elem.parentElement;
	return elem;
}

function langMenu()
{
	bodyOnClick();

	window.event.returnValue = false;
	window.event.cancelBubble = true;

	var div = document.all.lang_menu;
	var lnk = window.event.srcElement;
	if (div && lnk) {
		var x = lnk.offsetLeft + lnk.offsetWidth - div.offsetWidth;
		div.style.pixelLeft = (x < 0) ? 0 : x;
		div.style.pixelTop = lnk.offsetTop + lnk.offsetHeight;
		div.style.visibility = "visible";
	}
}

function chooseLang(item)
{
	window.event.returnValue = false;
	window.event.cancelBubble = true;

	if (item) {
		closeMenu();
		curLang = item.innerText;
		showAll = false;
	}

	if (cook) {
		cook.putValue('lang', curLang);
		cook.putValue('lang.all', '');
	}

	filterLang();
}

function chooseAll()
{
	window.event.returnValue = false;
	window.event.cancelBubble = true;

	closeMenu();

	showAll = true;
	if (cook)
		cook.putValue('lang.all', '1');

	unfilterLang();
}

function closeMenu()
{
	var div = document.all.lang_menu;
	if (div && div.style.visibility != "hidden") {
		var lnk = document.activeElement;
		if (lnk && lnk.tagName == "A")
			lnk.blur();

		div.style.visibility = "hidden";
	}
}

function getNext(elem)
{
	for (var i = elem.sourceIndex + 1; i < document.all.length; i++) {
		var next = document.all[i];
		if (!elem.contains(next))
			return next;
	}
	return null;
}

function filterMatch(text, name)
{
	var a = text.split(",");
	for (var iTok = 0; iTok < a.length; iTok++) {
		var m = a[iTok].match(/([A-Za-z].*[A-Za-z+])/);
		if (m && m[1] == name)
			return true;
	}
	return false;
}

function topicHeading(head)
{
	var iLim = document.body.children.length;
	var idxLim = head.sourceIndex;

	for (var i = 0; i < iLim; i++) {
		var elem = document.body.children[i];
		if (elem.sourceIndex < idxLim) {
			if (elem.tagName.match(/^(P)|(PRE)|([DOU]L)$/))
				return false;
		}
		else
			break;
	}
	return true;
}

function filterLang()
{
	var spans = document.all.tags("SPAN");
	for (var i = 0; i < spans.length; i++) {
		var elem = spans[i];
		if (elem.className == "lang") {
			var newVal = filterMatch(elem.innerText, curLang) ? "block" : "none";
			var block = getBlock(elem);
			block.style.display = newVal;
			elem.style.display = "none";

			if (block.tagName == "DT") {
				var next = getNext(block);
				if (next && next.tagName == "DD")
					next.style.display = newVal;
			}
			else if (block.tagName == "DIV") {
				block.className = "filtered2";
			}
			else if (block.tagName.match(/^H[1-6]$/)) {
				if (topicHeading(block)) {
					if (newVal != "none") {
						var tag = null;
						if (block.children && block.children.length) {
							tag = block.children[block.children.length - 1];
							if (tag.className == "ilang") {
								tag.innerHTML = (newVal == "block") ?
									'&nbsp; [Language: ' + curLang + ']' : "";
							}
						}
					}
				}
				else {
					var next = getNext(block);
					while (next && !next.tagName.match(/^(H[1-6])|(DIV)$/)) {
						next.style.display = newVal;
						next = getNext(next);
					}
				}
			}
		}
		else if (elem.className == "ilang") {
			elem.innerHTML = '&nbsp; [Language: ' + curLang + ']';
		}
	}

	if (ie4) {
		document.body.style.display = "none";
		document.body.style.display = "block";
	}
}

function unfilterLang(name)
{
	var spans = document.all.tags("SPAN");
	for (var i = 0; i < spans.length; i++) {
		var elem = spans[i];
		if (elem.className == "lang") {
			var block = getBlock(elem);
			block.style.display = "block";
			elem.style.display = "inline";

			if (block.tagName == "DT") {
				var next = getNext(block);
				if (next && next.tagName == "DD")
					next.style.display = "block";
			}
			else if (block.tagName == "DIV") {
				block.className = "filtered";
			}
			else if (block.tagName.match(/^H[1-6]$/)) {
				if (topicHeading(block)) {
					var tag = null;
					if (block.children && block.children.length) {
						tag = block.children[block.children.length - 1];
						if (tag && tag.className == "ilang")
							tag.innerHTML = "";
					}
				}
				else {
					var next = getNext(block);
					while (next && !next.tagName.match(/^(H[1-6])|(DIV)$/)) {
						next.style.display = "block";
						next = getNext(next);
					}
				}
			}
		}
		else if (elem.className == "ilang") {
			elem.innerHTML = "";
		}
	}
}

function initFeedback()
{
	var hdr = document.all.hdr;
	if (!hdr)
		return;

	var L_Feedback = "Give feedback";
	var hPos = document.body.clientWidth - 24;

	var td  = hdr.insertCell(-1);
	if (td)
	{
		td.className = "button1";
		td.style.position = "absolute";
		td.id = "idFeedbackButton";
		td.style.left = hPos;
		td.onclick = sendFeedback;
		td.innerHTML = '<IMG SRC="' + baseUrl + 'feedback.jpg' + '" ALT="' + L_Feedback + '" ALIGN="right">';


	}

}

function moveFeedback()
{
	var tdFeedback = document.all.idFeedbackButton;
	if (!tdFeedback)
		return;
	var hPos = document.body.clientWidth - 24;
	tdFeedback.style.left = hPos;
}

function sendFeedback()
{
	var TITLEs = document.all.tags("TITLE");

	if (!TITLEs)
		return;

	var sTitle = TITLEs(0).innerHTML;
	var sSubject = "Doc feedback on page:" + sTitle;	
	var sFeedbackURL = "mailto:xboxds@xbox.com?subject=" + sSubject;
	window.open(sFeedbackURL);
}

//
// Reftips (parameter popups)
//
function initReftips()
{
	var DLs = document.all.tags("DL");
	var PREs = document.all.tags("PRE");
	if (DLs && PREs) {
		var iDL = 0;
		var iPRE = 0;
		var iSyntax = -1;
		for (var iPRE = 0; iPRE < PREs.length; iPRE++) {
			if (PREs[iPRE].className == "syntax") {
				while (iDL < DLs.length && DLs[iDL].sourceIndex < PREs[iPRE].sourceIndex)
					iDL++;			
				
				if (iDL < DLs.length) 
				{
					if (DLs[iDL].id == "idXML")
					{
						var xmlDLs = document.all.item("idXML");
						var undefined; // Used only for testing undefined
						if (xmlDLs.length == undefined)
						{
							initSyntax(PREs[iPRE], DLs[iDL]);
							iSyntax = iPRE;
						}
						else
						{
							for (var ixmlDL = 0; ixmlDL < xmlDLs.length; ixmlDL++)
							{
								initSyntax(PREs[iPRE], xmlDLs[ixmlDL]);
								iSyntax = iPRE;
							}
						}
					}
					else
					{
						initSyntax(PREs[iPRE], DLs[iDL]);
						iSyntax = iPRE;
					}
				}
			}
		}

		if (iSyntax >= 0) {
			var last = PREs[iSyntax];
			last.insertAdjacentHTML(
				'AfterEnd',
				'<DIV ID=reftip CLASS=reftip STYLE="position:absolute;visibility:hidden;overflow:visible;"></DIV>'
				);
		}
	}
}

function initSyntax(pre, dl)
{
	var strSyn = pre.outerHTML;
	var ichStart = strSyn.indexOf('>', 0) + 1;
	var terms = dl.children.tags("DT");
	if (terms) {
		for (var iTerm = 0; iTerm < terms.length; iTerm++) {
			var words = terms[iTerm].innerText.replace(/\[.+\]/g, " ").replace(/,/g, " ").split(" ");
			var htm = terms[iTerm].innerHTML;
			for (var iWord = 0; iWord < words.length; iWord++) {
				var word = words[iWord];

				if (word.length > 0 && htm.indexOf(word, 0) < 0)
					word = word.replace(/:.+/, "");

				if (word.length > 0) {
					var ichMatch = findTerm(strSyn, ichStart, word);
					while (ichMatch > 0) {
						var strTag = '<A HREF="" ONCLICK="showTip(this)" CLASS="synParam">' + word + '</A>';

						// If the data list is part of the definition for an 
						// XML syntax page, then we will stick on the extra div 
						// tag so that it can be found later.
						if (dl.id == "idXML")
						{
							strTag = strTag + '<div class="clsXML" style="display:none;"></div>';
						}
						
						strSyn =
							strSyn.slice(0, ichMatch) +
							strTag +
							strSyn.slice(ichMatch + word.length);

						ichMatch = findTerm(strSyn, ichMatch + strTag.length, word);
					}
				}
			}
		}
	}

	// Replace the syntax block with our modified version.
	pre.outerHTML = strSyn;
}

function findTerm(strSyn, ichPos, strTerm)
{
	var ichMatch = strSyn.indexOf(strTerm, ichPos);
	 
 	// Need to check that strTerm is not immediately preceeded by a struct
 	// WARNING: This is pretty much of a hack. We are assuming good formating
 	// of the code, namely that there is a single space between the "struct" and the
 	// structure name.
 	var ichStruct= strSyn.indexOf("struct");
	if (ichStruct > -1 && ichMatch == (ichStruct + 7))
 		 ichMatch = strSyn.indexOf(strTerm, ichMatch + strTerm.length);

	// Also need to check that strTerm is not immediately preceeded by a tilda (~).
	// we are not interested in destructors. WARNING: this will probably kill the two's 
	// complement operator as well, but that shouldn't be get hottext anyway.
	if (ichStruct > -1 && ichMatch > -1 && strSyn.substr(ichMatch - 1, 1) == "~")
		ichMatch = strSyn.indexOf(strTerm, ichMatch + strTerm.length);
	
	while (ichMatch >= 0) {
		var prev = (ichMatch == 0) ? '\0' : strSyn.charAt(ichMatch - 1);
		var next = strSyn.charAt(ichMatch + strTerm.length);
		if (prev != '<' && !isalnum(prev) && !isalnum(next)) {
			var ichComment = strSyn.indexOf("/*", ichPos);
			while (ichComment >= 0) {
				if (ichComment > ichMatch) { 
					ichComment = -1;
					break; 
				}
				var ichEnd = strSyn.indexOf("*/", ichComment);
				if (ichEnd < 0 || ichEnd > ichMatch)
					break;
				ichComment = strSyn.indexOf("/*", ichEnd);
			}
			if (ichComment < 0) {
				ichComment = strSyn.indexOf("//", ichPos);
				while (ichComment >= 0) {
					if (ichComment > ichMatch) {
						ichComment = -1;
						break; 
					}
					var ichEnd = strSyn.indexOf("\n", ichComment);
					if (ichEnd < 0 || ichEnd > ichMatch)
						break;
					ichComment = strSyn.indexOf("//", ichEnd);
				}
			}
			if (ichComment < 0)
				break;
		}
		ichMatch = strSyn.indexOf(strTerm, ichMatch + strTerm.length);
	}
	return ichMatch;
}

function isalnum(ch)
{
	return ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || (ch == '_'));
}

function showTip(link)
{
	bodyOnClick();

	var tip = document.all.reftip;
	if (!tip || !link)
		return;

	window.event.returnValue = false;
	window.event.cancelBubble = true;

	// Hide the tip if necessary and initialize its size.
	tip.style.visibility = "hidden";
	tip.style.pixelWidth = 260;
	tip.style.pixelHeight = 24;

	// Find the link target.
	var term = null;
	var def = null;
	var DLs = document.all.tags("DL");
	for (var iDL = 0; iDL < DLs.length; iDL++) {
		if (DLs[iDL].sourceIndex > link.sourceIndex) {
			var dl = DLs[iDL];
			var iMax = dl.children.length - 1;
			for (var iElem = 0; iElem < iMax; iElem++) {
				var dt = dl.children[iElem];
				if (dt.tagName == "DT" && dt.style.display != "none") {
					if (findTerm(dt.innerText, 0, link.innerText) >= 0) {
						var dd = dl.children[iElem + 1];
						if (dd.tagName == "DD") {
							term = dt;
							def = dd;
						}
						break;
					}
				}
			}
			// If the link comes from an XML syntax block there is the 
			// possibility that up to two different DLs may need to be looked 
			// at. This may lead to some unexpected behavior on the XML syntax 
			// pages in which case, the logic needs to be reassesed.
			if (link.nextSibling && link.nextSibling.className != "clsXML")
			{
				break;
			}
		}
	}

	if (def) {
		window.linkElement = link;
		window.linkTarget = term;
		tip.innerHTML = '<DL><DT>' + term.innerHTML + '</DT><DD>' + def.innerHTML + '</DD></DL>';
		window.setTimeout("moveTip()", 0);
	}
}

function jumpParam()
{
	hideTip();

	window.linkTarget.scrollIntoView();
	document.body.scrollLeft = 0;

	flash(3);
}

function flash(c)
{
	window.linkTarget.style.background = (c & 1) ? "#FFFF80" : "";
	if (c)
		window.setTimeout("flash(" + (c-1) + ")", 200);
}

function moveTip()
{
	var tip = document.all.reftip;
	var link = window.linkElement;
	if (!tip || !link)
		return; //error

	var w = tip.offsetWidth;
	var h = tip.offsetHeight;

	if (w > tip.style.pixelWidth) {
		tip.style.pixelWidth = w;
		window.setTimeout("moveTip()", 0);
		return;
	}

	var maxw = document.body.clientWidth;
	var maxh = document.body.clientHeight;

	if (h > maxh) {
		if (w < maxw) {
			w = w * 3 / 2;
			tip.style.pixelWidth = (w < maxw) ? w : maxw;
			window.setTimeout("moveTip()", 0);
			return;
		}
	}

	var x,y;

	var linkLeft = link.offsetLeft - document.body.scrollLeft;
	var linkRight = linkLeft + link.offsetWidth;

	var linkTop = link.offsetTop - document.body.scrollTop;
	var linkBottom = linkTop + link.offsetHeight;

	var cxMin = link.offsetWidth - 24;
	if (cxMin < 16)
		cxMin = 16;

	if (linkLeft + cxMin + w <= maxw) {
		x = maxw - w;
		if (x > linkRight + 8)
			x = linkRight + 8;
		y = maxh - h;
		if (y > linkTop)
			y = linkTop;
	}
	else if (linkBottom + h <= maxh) {
		x = maxw - w;
		if (x < 0)
			x = 0;
		y = linkBottom;
	}
	else if (w <= linkRight - cxMin) {
		x = linkLeft - w - 8;
		if (x < 0)
			x = 0;
		y = maxh - h;
		if (y > linkTop)
			y = linkTop;
	}
	else if (h <= linkTop) {
		x = maxw - w;
		if (x < 0)
			x = 0;
		y = linkTop - h;
	}
	else if (w >= maxw) {
		x = 0;
		y = linkBottom;
	}
	else {
		w = w * 3 / 2;
		tip.style.pixelWidth = (w < maxw) ? w : maxw;
		window.setTimeout("moveTip()", 0);
		return;
	}
	
	link.style.background = "#FFFF80";
	tip.style.pixelLeft = x + document.body.scrollLeft;
	tip.style.pixelTop = y + document.body.scrollTop;
	tip.style.visibility = "visible";
}

function hideTip()
{
	if (window.linkElement) {
		window.linkElement.style.background = "";
		window.linkElement = null;
	}

	var tip = document.all.reftip;
	if (tip) {
		tip.style.visibility = "hidden";
		tip.innerHTML = "";
	}
}

function beginsWith(s1, s2)
{
	// Does s1 begin with s2?
	return s1.substring(0, s2.length) == s2;
}

//
// See Also popups
//
function initSeeAlso()
{
	// Localizable strings.
	var L_See_Also = "See Also";
	var L_Requirements = "Requirements";
	var L_See_Also_nihongo = "ŠÖ˜A€–Ú ";
	var L_Requirements_nihongo = "—vŒ";
	var L_QuickInfo = "QuickInfo";

	

	var hdr = document.all.hdr;
	if (!hdr)
		return;

	var divS = new String;
	var divR = new String;

	var heads = document.all.tags("H4");
	if (heads) {
		for (var i = 0; i < heads.length; i++) {
			var head = heads[i];
			var txt = head.innerText;
			if (beginsWith(txt, L_See_Also) || beginsWith(L_See_Also_nihongo, txt)) {
				divS += head.outerHTML;
				var next = getNext(head);
				while (next && !next.tagName.match(/^(H[1-4])|(DIV)$/)) {
					divS += next.outerHTML;
					next = getNext(next);
				}
			}
			else if (beginsWith(txt, L_Requirements) || beginsWith(txt, L_Requirements_nihongo) || 
				beginsWith(txt, L_QuickInfo)) {
				divR += head.outerHTML;
				var next = getNext(head);
				while (next && !next.tagName.match(/^(H[1-4])|(DIV)$/)) {
					divR += next.outerHTML;
					next = getNext(next);
				}
			}
		}
	}

	var pos = getNext(hdr.parentElement);
	if (pos) {
		if (divR != "") {
			divR = '<DIV ID=rpop CLASS=sapop>' + divR + '</DIV>';
			var td = hdr.insertCell(0);
			if (td) {
				td.className = "button1";
				td.style.width = "19px";
				td.onclick = showRequirements;
				td.innerHTML = '<IMG SRC="' + baseUrl + 'requirements.jpg' + '" ALT="' + L_Requirements + '" BORDER=0>';
				if (ie4)
					document.body.insertAdjacentHTML('AfterBegin', divR);
				else
					document.body.insertAdjacentHTML('BeforeEnd', divR);
			}
		}
		if (divS != "") {
			divS = '<DIV ID=sapop CLASS=sapop>' + divS + '</DIV>';
			var td = hdr.insertCell(0);
			if (td) {
				td.className = "button1";
				td.style.width = "19px";
				td.onclick = showSeeAlso;
				td.innerHTML = '<IMG SRC="' + baseUrl + 'seealso.jpg' + '" ALT="' + L_See_Also + '" BORDER=0>';
				if (ie4)
					document.body.insertAdjacentHTML('AfterBegin', divS);
				else
					document.body.insertAdjacentHTML('BeforeEnd', divS);
			}
		}
	}
}

function showSeeAlso()
{
	bodyOnClick();

	window.event.returnValue = false;
	window.event.cancelBubble = true;

	var div = document.all.sapop;
	var lnk = window.event.srcElement;

	if (div && lnk) {
		div.style.pixelTop = lnk.offsetTop + lnk.offsetHeight;
		div.style.visibility = "visible";
	}
}

function showRequirements()
{
	bodyOnClick();

	window.event.returnValue = false;
	window.event.cancelBubble = true;

	var div = document.all.rpop;
	var lnk = window.event.srcElement;

	if (div && lnk) {
		div.style.pixelTop = lnk.offsetTop + lnk.offsetHeight;
		div.style.visibility = "visible";
	}
}

function hideSeeAlso()
{
	var div = document.all.sapop;
	if (div)
		div.style.visibility = "hidden";

	var div = document.all.rpop;
	if (div)
		div.style.visibility = "hidden";
}







//****************************************************************************************************************************
//********************************************  IE5 PERSISTENCE  *************************************************************
//****************************************************************************************************************************

var oTD,iTD;         // persistence

//****** Persistence for userData ********************************************************************************************* 

function getChecklistState(){ 
 
 var pageID= addID();

	var t = checklist;

	if (checklist.all== "[object]") {
	oTD=checklist.all.tags("INPUT");
	iTD= oTD.length;
		}
	else
		{
		printing = "TRUE";
		isPersistent = false;
		return;
		}

	if (iTD == 0){
		printing = "TRUE";
		isPersistent = false;
		return;
		}
	
// routine added to fix a bug in the ocx 06/14/99	
     lct = document.location + ".";
	 xax = 10;
	 xax = lct.indexOf("mk:@MSITStore");
	 if (xax != -1) {
	 	lct = "ms-its:" + lct.substring(14,lct.length-1);
		isPersistent = false;
		document.location.replace(lct);
		isPersistent = true;
		// alert("after reload : " + document.location);
		}	 
	 else
	 	{ 	 
     	checklist.load("oXMLStore");
		}
//  routine added to fix a bug in the ocx 06/14/99

    xax = 10;
	xax = pageID.indexOf("~");
	if (xax == -1) {
    	if (checklist.getAttribute("sPersist"+pageID+"0"))	
    	for (i=0; i<iTD; i++){
	
        if (oTD[i].type =="checkbox" || oTD[i].type =="radio"){
	    checkboxValue= checklist.getAttribute("sPersist"+pageID+i);
		
	   	if (checkboxValue=="yes") oTD[i].checked=true;
		else oTD[i].checked=false;
		}// if
		if (oTD[i].type =="text") 		     
 	    oTD[i].value= checklist.getAttribute("sPersist"+pageID+i);
     	}// for
	 }
} // end persistence

//**  saveChecklistState *************************************************************************************************************
function saveChecklistState(){
var pageID= addID(); 

        if (!isPersistent) return; 
 		//  you will need this           document.location
	xax = 10;
	xax = pageID.indexOf("~");
	if (xax == -1) {
        for (i=0; i<iTD; i++){

       	     if (oTD[i].type =="checkbox" || oTD[i].type =="radio"){
	             if (oTD[i].checked) checkboxValue="yes";
		         else checkboxValue="no";
				 
	             checklist.setAttribute("sPersist"+pageID+i, checkboxValue);
	         }// if
			
 		     if (oTD[i].type =="text") 
			     checklist.setAttribute("sPersist"+pageID+i, oTD[i].value);
		 }	// for
	}
	
 // routine added to fix a bug in the ocx 06/14/99	
     lct = document.location + ".";
	 xax = 10;
	 xax = lct.indexOf("mk:@MSITStore");
	 if (xax != -1) {
	 	lct = "ms-its:" + lct.substring(14,lct.length-1);
		isPersistent = false;
		document.location.replace(lct);
		isPersistent = true;
		// alert("after reload : " + document.location);
		}	 
	 else
	 	{ 	 
     	checklist.save("oXMLStore");
		}
// routine added to fix a bug in the ocx 06/14/99
	 
}//end function

//**  resizeDiv *******************************[used with callPopupWeb, setPreviousNext}****************************************************
//  resize the page when the <div class=nav></div> && <div class=text></div> are found
function resizeDiv(){
if (printing == "TRUE") return;
var oNav = document.all.item("nav");
var oText= document.all.item("text");

    if (popupOpen) closePopup();
	if (oText == null) return;
    if (oNav != null){
        document.all.nav.style.width= document.body.offsetWidth;
	    document.all.text.style.width= document.body.offsetWidth-4;
	    document.all.text.style.top= document.all.nav.offsetHeight;
	    if (document.body.offsetHeight > document.all.nav.offsetHeight)
	        document.all.text.style.height= document.body.offsetHeight - document.all.nav.offsetHeight;
 	    else document.all.text.style.height=0; 
  }
}

//**  addID *************************************************************************************************************
function addID(){

var locID = document.location.href; 
var iHTM = locID.lastIndexOf(".htm");
var iName=locID.lastIndexOf("/");
      locID = locID.substring(iName+1,iHTM);
	
	return locID;
}	
//** set_to_print ***************
function set_to_print(){
	var i;
	printing = "TRUE";
	
	if (window.text) {
		if (!window.text.style){
			scroller = "FALSE";
			}
		else
			{
			document.all.text.style.height = "auto";
			scroller = "TRUE";
			}
		}
		
	for (i=0; i < document.all.length; i++){
		if (document.all[i].id == "expand") {
			callExpand(document.all[i]);
			single = "TRUE";
			}
		if (document.all[i].tagName == "BODY") {
			document.all[i].scroll = "auto";
			}
		if (document.all[i].tagName == "A" && scroller != "TRUE") {
			document.all[i].outerHTML = "<A HREF=''>" + document.all[i].innerHTML + "</a>";
			}
		}

}
//** used to reset a page if needed ********************
function reset_form(){

	if (single == "TRUE") document.location.reload();
	if (scroller = "TRUE") document.location.reload();
	
}

	
//** on error routine *********************************
function errorHandler() {
  // alert("Error Handled");
  return true;
}

//*** ACHELP functions ***

function EMailStream()
{
var stream;
var title;
var pageHref;


pageHref=window.location.href;

title = document.title;

//Replace quote \" with ""
var re = new RegExp('\"',"g") 
var title = title.replace(re,"");

if (title == ""){
	title = "Documentation Feedback";
	}

var strPage = " (" + ParseFileName(pageHref) + ")";

var MailToHref = '"' + "mailto:acdocs@microsoft.com?SUBJECT=" + title + strPage + '"';

stream = "<EM>Did you find this material useful? Please send your suggestions and comments to us at</EM> <a href=" +  MailToHref + ">Application Center Documentation Feedback</a>.";

return stream;

}

function ParseFileName(Filename)
{
  var newFileName;
  var intPos = Filename.lastIndexOf("/");
  var intLen = Filename.length;
  newFileName = Filename.substr(intPos + 1, intLen  - intPos)
  
  return newFileName;
}

//*** ACHelp Functions
function showGlossaryDef(elem, inPopup)
{
	var projectTerm = elem.hash;

	popupWindow.style.width = 200;
 	popupWindow.style.padding = 10;
	popupWindow.style.fontsize = 10;
       	popupWindow.innerHTML = '\t'+getXMLPopupContent(projectTerm);
	positionPopup(elem, inPopup);
	popupWindow.style.visibility = "visible";
}

function getXMLPopupContent(projectTerm)
{
	var term, termID;
	var entry;
	var scopeDefs;
	var scopes;
	var definition;
	var seeAlsos, seeAlsoID, seeAlsoTerm;
	var seeEntry, seeID, seeTerm;
	var outText;
	var i, j, k, l, m;
	var scopeFound;
	var noDef = "<h3>" + L_NoDefAlertTitle_Text + "</h3><p>" + L_NoDefAlert_Text + "</p>";
	var xmlDOM;

	if (projectTerm.length > 1)
	{
		termID = projectTerm.substring(1, projectTerm.length);
		i = termID.indexOf(":");
		if (i > 0)
			term = termID.substring(i+1, termID.length);
		else
			return (noDef);
	}
	else{
		return (noDef);
	}
                    
	xmlDOM = new ActiveXObject("Microsoft.XMLDOM");
	xmlDOM.async = false;
	xmlDOM.validateOnParse = false;
	xmlDOM.load(xmlFilePath);
	  
	outText = noDef;

	entry = xmlDOM.nodeFromID(term);
	if (entry != null){
		scopeDefs = entry.selectNodes("scopeDef");
		scopeFound = false;
		for (i = 0; i < scopeDefs.length && !scopeFound; i++)
		{
			scopes = scopeDefs(i).selectNodes("scope");
			for (j = 0; j < scopes.length; j++)
			{
				if (scopes(j).attributes.getNamedItem("scopeTermID").text == termID)
				{
		  			scopeFound = true;
					outText = formatXMLTerm(entry.selectSingleNode("term").text);
					if (scopeDefs(i).selectSingleNode("def") != null)
					{
						definition = formatXMLDef(scopeDefs(i).selectSingleNode("def"));
						outText = outText + definition;
						seeAlsos = scopeDefs(i).selectNodes("seeAlso");
						seeAlsoID = "";
						seeAlsoTerm = "";
						for (k = 0; k < seeAlsos.length; k++)
						{
							seeAlsoID = seeAlsos(k).attributes.getNamedItem("seeAlsoID").text;
							l = seeAlsoID.indexOf(":");
							if (l > 0)
							{
								seeAlsoScope = seeAlsoID.substring(0, l + 1);
								seeAlsoID = seeAlsoID.substring(l + 1, seeAlsoID.length);
							}
							else
								seeAlsoScope = "";
							seeAlsoTerm = xmlDOM.nodeFromID(seeAlsoID).selectSingleNode("term").text;
							outText = outText + formatXMLSeeAlso(seeAlsoScope + seeAlsoID, seeAlsoTerm, (k == 0));}        
							if (k > 0)
								outText = outText + "</P>";
						}
					else
					{
						seeEntry = scopeDefs(i).selectSingleNode("seeEntry");
						seeID = seeEntry.attributes.getNamedItem("seeID").text;
						k = seeID.indexOf(":");
						if (k > 0)
						{
							seeScope = seeID.substring(0, k + 1);
							seeID = seeID.substring(k + 1, seeID.length);
						}
						else
							seeScope = "";
						seeTerm = xmlDOM.nodeFromID(seeID).selectSingleNode("term").text;
						outText = outText + formatXMLSee(seeScope + seeID, seeTerm);
					}
				}
			}
		}
	}
	else
		outText = noDef;
	return (outText);
}

function formatXMLTerm(theTerm)
{
	return ("<h3>" + theTerm + "</h3>");
}

function formatXMLDef(def)
{
	var paras;
	var i;
	var defOut;

	paras = def.selectNodes("para");
	defOut = "";
	for (i = 0; i < paras.length; i++)
		defOut = defOut + "<p>" + paras(i).text + "</p>";
	return (defOut);
}

function formatXMLSee(seeTermID, seeTerm)
{
	var seeText;

	seeText = "<a id='In_Popup' href='#" + seeTermID + "'>" + seeTerm + "</a>";
	return ("<p id='SeeDef'>" + L_See_Text + seeText);
}


function formatXMLSeeAlso(seeAlsoTermID, seeAlsoTerm, bFirstOne)
{
	var seeAlsoText;

	seeAlsoText = "<a id='In_Popup' href='#" + seeAlsoTermID + "'>" + seeAlsoTerm + "</a>";
	if (bFirstOne)
		return ("<p id='OtherDefs'>" + L_SeeAlso_Text + seeAlsoText);
	else
		return (", " + seeAlsoText);
}


function positionPopup(e, inPopup)
{
	var pageBottom = document.body.scrollTop + document.body.clientHeight;
	var popHeight = popupWindow.offsetHeight;

	if (inPopup)
	{
		ieX = popupWindow.style.left;
		ieY = popupWindow.style.top;
	}
	else
	{
		if (e.offsetParent.tagName.toLowerCase() == 'body')
		{
			ieX = e.offsetLeft;
			ieY = ((e.offsetTop) + (e.offsetHeight) + 1);
		}
		else if (e.offsetParent.offsetParent.tagName.toLowerCase() == 'body')
		{
			ieX = ((e.offsetLeft) + (e.offsetParent.offsetLeft));
			ieY = ((e.offsetHeight) + (e.offsetTop) + (e.offsetParent.offsetTop) + (1));
		}
		else if (e.offsetParent.offsetParent.offsetParent.tagName.toLowerCase() == 'body')
		{
			ieX = ((e.offsetLeft) + (e.offsetParent.offsetLeft) + (e.offsetParent.offsetParent.offsetLeft));
			ieY = ((e.offsetHeight) + (e.offsetTop) + (e.offsetParent.offsetTop) + (e.offsetParent.offsetParent.offsetTop) + (1));
		}
		else
		{
			ieX = window.event.clientX;
			ieY = window.event.clientY + document.body.scrollTop;
		}
	}
 	var rightlimit = ieX + popupWindow.offsetWidth;
	if (rightlimit >= document.body.clientWidth)
	{
		ieX -= (rightlimit - document.body.clientWidth);
	}


	popupWindow.style.height = popHeight - 2 * (parseInt(popupWindow.style.borderWidth));

	if (popHeight + ieY >= pageBottom)
	{
		if (popHeight <= pageBottom)
		{
			ieY = pageBottom - popHeight;
		}
		else
		{
			ieY = 0;
		}
	}
	popupWindow.style.left = ieX;
	popupWindow.style.top = ieY;
}

