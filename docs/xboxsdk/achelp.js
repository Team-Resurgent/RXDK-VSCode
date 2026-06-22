// Filename: shared.js in ac2k.chm
// Version post-M4 (1)
// version 03.09.00

//************************************************ EVENT HANDLING ********************************************
//*******************************************************************************************************************
//  re-directs to the proper event-driven functions.

window.onload= loadPage;
document.onclick= onclickTriage;
document.onmouseover= gettingHot;
document.onmouseout= gettingCold;
window.onunload=saveChecklistState;
window.onresize= resizeDiv;

window.onbeforeprint= set_to_print;
window.onafterprint= reset_form;
//********************************************  USER-DEFINED GLOBAL VARIABLES  ************************************
//********************************************************************************************************************

// *** ACHELP
// Localized code
var L_NoDefAlertTitle_Text = "Definition Unavailable";
var L_NoDefAlert_Text = "The glossary term and definition do not exist in the glossary " +
	"file at this time.";
var L_See_Text = "<b>See:&nbsp;</b>"
var L_SeeAlso_Text = "<b>See Also:&nbsp;</b>"
var L_GlossaryAlt_ToolTip = "View definition";

// Glossary global variables and init
var ie4 = false;
var includeglossIMG = false;
var xmlFilePath = "gloss.xml";
var glossImgPath = "glossary.gif";
var popupDIV = "<div id='popupWindow' style='visibility:hidden; position:absolute; " +
	"top:0px; left:0px; background-color:#ffffcc; " +
	"border:solid 1 #333333'></div>";
var glossImg = "<IMG CLASS='PopUp' SRC='" + glossImgPath + "' HEIGHT='9' WIDTH='12' BORDER='0'>";
var ieX, ieY;

if (navigator.appName == "Microsoft Internet Explorer")
{
	var ver = navigator.appVersion;
	var inx = ver.indexOf(".", 0);
	var v = new Number(ver.substring(0,inx));
	if (v >= 4)
			ie4 = true;
}

if (! ie4)
	alert("MS Internet Explorer version 4 or greater is required.");



//*** End ACSHELP






//  The images listed below can all be changed by the user.

var sPreviousTip= "Previous topic";
var sNextTip= "Next topic";
var sExpandTip= "Expand/collapse";
var sPopupTip= "View definition";
var sShortcutTip= "";

var moniker= "ms-its:";                                         // moniker= ""; for flat files
var sSharedCHM= moniker+"ntshared.chm::/";

var closed = "plusCold.gif";				//image used for collapsed item in callExpand()
var closedHot = "plusHot.gif";			//hot image used for collapsed item in callExpand()
var expand = "minusCold.gif";			//image used for expanded item in callExpand()
var expandHot = "minusHot.gif";		//hot image used for expanded item in callExpand()

var previousCold= sSharedCHM + "previousCold.gif";
var previousHot= sSharedCHM + "previousHot.gif"; 
var nextCold= sSharedCHM + "nextCold.gif";
var nextHot= sSharedCHM + "nextHot.gif"; 

var shortcutCold= sSharedCHM + "shortcutCold.gif";
var shortcutHot= sSharedCHM + "shortcutHot.gif";

var popupCold= sSharedCHM + "popupCold.gif";
var popupHot= sSharedCHM + "popupHot.gif";

var emptyImg= sSharedCHM + "empty.gif";		//image used for empty expand
var noteImg= sSharedCHM + "note.gif";			//image used for notes
var tipImg= sSharedCHM + "tip.gif";			//image used for tips
var warningImg= sSharedCHM + "warning.gif";		//image used for warnings
var cautionImg= sSharedCHM + "caution.gif";		//image used for cautions
var importantImg= sSharedCHM + "important.gif";		//image used for important notice
var relTopicsImg= sSharedCHM + "rel_top.gif";		//image used for important notice

var branchImg= sSharedCHM + "elle.gif";
var branchImg_RTL= sSharedCHM + "elle_rtl.gif";


//********************************************  GLOBAL VARIABLES  ******************************************
//********************************************************************************************************

var printing = "FALSE";
var single = "FALSE";
var scroller = "FALSE";
var isRTL= (document.dir=="rtl");
var imgStyleRTL= ""; 
      if (isRTL) imgStyleRTL=" style='filter:flipH' ";

var sActX_TDC= "CLASSID='CLSID:333C7BC4-460F-11D0-BC04-0080C7055A83'";		//Tabular Data Control  for  reusable text data
var sSharedReusableTextFile= sSharedCHM + "shared.txt";										// common reusable text file
var sSharedReusableTextFileRecord= "para";														//reusable text record

var numbers= /\d/g;				//javascript regular expression
var spaces= /\s/g;				//javascript regular expression
var semicolon= /;/g;			//javascript regular expression

var isIE5= (navigator.appVersion.indexOf("MSIE 5")>0) || (navigator.appVersion.indexOf("MSIE")>0 && parseInt(navigator.appVersion)> 4);
var isPersistent= false;


//********************************************  INITIALIZATION  *************************************************
//******************************************************************************************************************

//*** loadPage **********************************************************************************************
//  Adds the default image tags and re-usable text to the HTML page.

function loadPage(){
isPersistent= (document.all.item("checklist")!=null) && (isIE5);
	
	//ACHelp
	document.body.insertAdjacentHTML('beforeEnd', popupDIV);
	var anchorTags = document.all.tags('A');
	for (var a = 0; a < anchorTags.length; a++)
		if (anchorTags[a].id.indexOf('PopUp') != -1)
		{
			anchorTags[a].title = L_GlossaryAlt_ToolTip;
			if (includeglossIMG)
				anchorTags[a].innerHTML = glossImg + anchorTags[a].innerHTML;
		}	
	//
	
  setPreviousNext();
  resizeDiv();
  if (isPersistent) getChecklistState();
  addReusableText();
  insertImages();
}

//****** setPreviousNext  ************************************************************************ ********************************************************************************************* 
// insert previous/next navbar
// called by: <div id="nav">@@HTMLsequenceFile.txt or .lst@@</div>

function setPreviousNext(){


  var oNav = document.all.item("nav");
        if (oNav == null ) return;
  
  var sPreviousALT= sPreviousTip;
  var sNextALT= sNextTip;
  var sHTMLfile= oNav.innerHTML;

  var imgPrev= "<IMG SRC='"+previousCold+"' BORDER=0 ALT='"+ sPreviousALT +"' ALIGN='top' "+ imgStyleRTL +">";
  var imgNext= "<IMG SRC='"+nextCold+"' BORDER=0 ALT='"+ sNextALT  + "' ALIGN='top' "+ imgStyleRTL +">";
  
  var previousNextObject= "<OBJECT ID='HTMlist' WIDTH=100 HEIGHT=51 " + sActX_TDC +"><param name='DataURL' value='"
		+sHTMLfile +"'><param name='UseHeader' value=True></OBJECT>";
	  
        oNav.innerHTML= "<TABLE WIDTH='100%' STYLE='margin-top:0;' cellspacing=0>"
		+ "<TR><TD style='text-align=left; background-color:transparent'><A ID='previousLink' HREF='#' REL='previous' CLASS='navbar'>"
        +imgPrev + "</A></TD><TD width='100%' align='center'></td><TD style='text-align=right; background-color:transparent'><A ID='nextLink' HREF='#' REL='next' CLASS='navbar'>"
		+imgNext+ "</A></TD></TR></TABLE>";
					
	  document.body.innerHTML= document.body.innerHTML +  previousNextObject;
	  findPageSeq();
	  if (printing == "TRUE") return;
      var  thisLoc= document.location.href +"#";

	  if (previousLink.href== thisLoc) previousLink.style.display="none";
	  else  previousLink.style.display="block";

	  if (nextLink.href== thisLoc) nextLink.style.display="none";
	  else  nextLink.style.display="block";
	  
}

//****** findPageSeq *********************************************************************************************
// finds this page in the "html sequence list" file (filename.lst) and determines the previous & next pages from the list
// the list is created from a tool named "chumper"

function findPageSeq() {

var rs= HTMlist.recordset;
var thisLoc= document.location.href;
var iLoc= thisLoc.lastIndexOf("/");

    if (iLoc > 0) thisLoc= thisLoc.substring(iLoc+1, thisLoc.length);
	
	
	if (nav.style == "[object]") {
				nav.style.visibility="hidden";
				printing = "FALSE";
				}
		else
			{
				printing = "TRUE";
				return;
			}
	
   	
    rs.moveFirst();
	   
	while (!rs.EOF) {
	      if (thisLoc == rs.fields("HTMfiles").value){
		      nav.style.visibility="visible"; 
  	          rs.MoveNext();
			  break;
		  }
		  previousLink.href=rs.fields("HTMfiles").value;	  
		  rs.moveNext();
     }
				
	  if (!rs.EOF) nextLink.href=rs.fields("HTMfiles").value;
}


//******Re-usable text ********************************************************************************************* 
// Inserts the Tabular Data Control (TDC) object at the end of the page 
// Inserts "re-usable text" from the txt file at: <span id="@@CHM_name@@@@index#@@" class="reuse"></span>
// e.g.<span id="printing4" class="reuse"></span> for record#4 in the printing.txt in printing.chm.

function addReusableText(){

var ntsharedAdded= false;					// make sure the object is only added once
var CHMspecificAdded= false;				// make sure the object is only added once
var coll = document.all.tags("SPAN");
var sIndex,sRecord,sFile,sFileID,dataBindingObject;

// TDC object for ntshared.chm
var coreObject= "WIDTH=100 HEIGHT=51 "+sActX_TDC+"><param name='UseHeader' value=True><param name='FieldDelim' value='~'><param name='sort' value='INDEX'>";
var shareTextObject = "<OBJECT ID='NTsharedText' " + coreObject + "<param name='DataURL' value='"+sSharedReusableTextFile+"'></OBJECT>";

    for (var i=0; i< coll.length; i++)                                   
         if (coll[i].className.toLowerCase()=="reuse"){
		     if (isRTL) coll[i].dir= "rtl";
			 
			 if (coll[i].id == null) return;
			 
   		     sFile= coll[i].id.toLowerCase();
			 sFile= sFile.replace(spaces,"");
			 sFileID= sFile;
             sFile= sFile.replace(numbers,""); 

		     if (sFile == sSharedReusableTextFileRecord) coll[i].dataSrc= "#NTsharedText";
			 else coll[i].dataSrc= "#CHMspecificText";
	
			 coll[i].dataField= "INDEX";
	  
			 if (!ntsharedAdded && sFile==sSharedReusableTextFileRecord){
			     document.body.innerHTML= document.body.innerHTML + shareTextObject;
		         ntsharedAdded= true;
			 }

			 else if (!CHMspecificAdded && sFile !=sSharedReusableTextFileRecord){
			          dataBindingObject= "<OBJECT ID='CHMspecificText'" + coreObject
					  + "<param name='DataURL' value='"+sSharedCHM+sFile+".txt'></OBJECT>";
                      document.body.innerHTML= document.body.innerHTML + dataBindingObject; 
				      CHMspecificAdded= true;
			 }
			   	 
		     if (sFile == sSharedReusableTextFileRecord)
			     sRecord= NTsharedText.recordset;
			 else sRecord= CHMspecificText.recordset; 
			 			 			 			 
			 sRecord.moveFirst(); 
	
	 		 do { sIndex= sRecord.fields("INDEX").value;
			         sText= sRecord.fields("TEXT").value;
					 
					 if (sIndex < sFileID) sRecord.moveNext();
					 else break;
		      } while (!sRecord.EOF);
				  
		       if (sIndex == sFileID) coll[i].innerHTML= sText;
	}		   
}

 //****** insertImages ********************************************************************************************* 
 //  Inserts shared images in User-Defined Variables section and thumbnails.
 
function insertImages(){

// insert alert icons
  var collP = document.all.tags("P");
  for (var i=0; i<collP.length; i++) {
       if (collP[i].className.toLowerCase()=="note")            collP[i].innerHTML ="<img class='alert' src='"+noteImg+"' "+ imgStyleRTL +"> " +     collP[i].innerHTML;
       else if (collP[i].className.toLowerCase()=="warning")    collP[i].innerHTML ="<img class='alert' src='"+warningImg+"'> " +  collP[i].innerHTML;
       else if (collP[i].className.toLowerCase()=="caution")    collP[i].innerHTML ="<img class='alert' src='"+cautionImg+"'> " +  collP[i].innerHTML;
       else if (collP[i].className.toLowerCase()=="tip")        collP[i].innerHTML ="<img class='alert' src='"+tipImg+"'> " +      collP[i].innerHTML;
       else if (collP[i].className.toLowerCase()=="important")  collP[i].innerHTML ="<img class='alert' src='"+importantImg+"'> " + collP[i].innerHTML;
       else if (collP[i].className.toLowerCase()=="empty")      collP[i].innerHTML ="<img class='alert' src='"+emptyImg+"'> " +    collP[i].innerHTML;
       else if (collP[i].className.toLowerCase()=="reltopics")  collP[i].innerHTML ="<img class='alert' src='"+relTopicsImg+"'> " + collP[i].innerHTML;
  }
  
//indents for Navigation Tree 
var collUL = document.all.tags("UL");

for (var i=0; i<collUL.length; i++) {
       var indent= 0;
       if (collUL[i].className.toLowerCase()=="navtree"){
	       if (isRTL) collUL[i].style.listStyleImage= "url('" + branchImg_RTL + "')";
		   else collUL[i].style.listStyleImage= "url('" + branchImg + "')";
  		   for (var j = 0; j < collUL[i].children.length; j++)
				if (collUL[i].children[j].className.toLowerCase()=="branch"){
					if (isRTL) collUL[i].children[j].style.marginRight= (indent +'em');
					else   collUL[i].children[j].style.marginLeft= (indent +'em');
					indent= indent + 0.75;
				}
	  }
}
   
  for (var i=0; i < document.anchors.length; i++){
         var imgInsert="";  
		 var imgStyle= "";
		 var imgSpace= "<span class='space'></span>";      
		 var oBefore=document.anchors[i].parentElement.tagName;
		 var oAnchor= document.anchors[i].id.toLowerCase();
         
// insert RELTOPICS icons
//       if (oAnchor=="reltopics")          
//		    if (document.anchors[i].children.tags("IMG")(0) && document.anchors[i].children.tags("IMG")(0).className.toLowerCase() == "reltopics")
//			        imgInsert= "";    // not to re-insert when persistent
//			else  imgInsert= "<img class='alert' src='"+relTopicsImg+"'>" + imgSpace;
			
// insert SHORTCUT icons
       if (oAnchor=="shortcut") {    
 	       document.anchors[i].title= sShortcutTip;     
		    if (document.anchors[i].children.tags("IMG")(0) && document.anchors[i].children.tags("IMG")(0).className.toLowerCase() == "shortcut")
			        imgInsert= "";    // not to re-insert when persistent
			else  imgInsert= "<img class='shortcut' src='"+shortcutCold+"' "+ imgStyleRTL+ ">" + imgSpace;
		}	
		   		   
// insert POPUP icons
       else if (oAnchor=="wpopup" || oAnchor=="wpopupweb") document.anchors[i].title= sPopupTip;
       else if (document.anchors[i].className.toLowerCase()=="popupicon")
		    if (document.anchors[i].children.tags("IMG")(0) && document.anchors[i].children.tags("IMG")(0).className.toLowerCase() == "popup")
			       imgInsert= "";    // not to re-insert when persistent
	        else imgInsert= "<img class='popup' src='"+popupCold+"'>" + imgSpace;

// insert EXPAND icons 
       else if (oAnchor=="expand") {
	          document.anchors[i].title= sExpandTip;
              if (document.anchors[i].children.tags("IMG")(0) && document.anchors[i].children.tags("IMG")(0).className.toLowerCase() == "expand")
		          imgInsert= ""; 	// not to re-insert when persistent	  
              else{ 
			      if (document.anchors[i].parentElement.offsetLeft == document.anchors[i].offsetLeft) {
				      imgSpace= "<span class='space' style='width:0'></span>";     
				      if (isRTL){ document.anchors[i].parentElement.style.marginRight= "1.5em";  imgStyle=" style=margin-right:'-1.5em'";}
					  else { document.anchors[i].parentElement.style.marginLeft= "1.5em";  imgStyle=" style=margin-left:'-1.5em'";}
				  }	  
			      imgInsert= "<img class='expand' src='"+ closed +"' "+imgStyle+">" +imgSpace;
	          }
       }

// insert thumbnail images	   
       else if (oAnchor=="thumbnail"  || oAnchor=="thumbnailweb"){ 
            var sAltText = document.anchors[i].innerHTML;

		    var sThumbnailText = document.anchors[i].title; 
            var oImg = document.anchors[i].href.toLowerCase();
		          if (oAnchor=="thumbnail") 
				         var sThumbnailImg= moniker + getURL(oImg);
				  else var sThumbnailImg = document.anchors[i].href.toLowerCase();
                document.anchors[i].outerHTML = "<DIV id='thumbDiv' class='thumbnail'>"+document.anchors[i].outerHTML+"</div>";
                document.anchors[i].innerHTML = "<img class='thumbnail' src='" + sThumbnailImg + "' alt= ' " + sAltText + "'><p>" +sThumbnailText+"</p>";
				
		          if (isRTL) thumbDiv.style.styleFloat= "right";
		   }
		
 	   document.anchors[i].innerHTML = imgInsert + document.anchors[i].innerHTML;
	   if (isRTL) document.anchors[i].dir="rtl";
   }
}


//***** onclickTriage ****************************************************************************************
// redirects to the appropriate function based on the ID of the clicked <A> tag.

function onclickTriage(){
var elem= window.event.srcElement;
var parentElem = elem;
//  if the innerHTML in the <a> tag is encapsulated by a style tag or hightlighted in the word seach,
//  the parentElement is called.
		
		//***
		for (; parentElem; parentElem = parentElem.parentElement)
		{
		if (parentElem.id == "PopUp" || parentElem.id == "In_Popup")
		{
			showGlossaryDef(parentElem, parentElem.id == "In_Popup");
			return;
		}
		}
		popupWindow.style.visibility = "hidden";
		
		//***
		
    for (var i=0; i < 5; i++)
           if (elem.tagName!="A" && elem.parentElement!=null) elem= elem.parentElement;
    eID= elem.id.toLowerCase();
				
    if (popupOpen) closePopup();
	
 // expand image in a new window
    if (eID=="thumbnail" || eID=="pophtm") popNewWindow(elem);
    else if (eID=="thumbnailweb") callThumbnailWeb(elem);
    else if (eID=="wpopup")    callPopup(elem);
    else if (eID=="wpopupweb") callPopupWeb(elem);
    else if (eID=="shortcut")  callShortcut(elem);
    else if (eID=="reltopics") callRelatedTopics(elem);
    else if (eID=="altloc")    callAltLocation(elem);
    else if (eID=="expand")    callExpand(elem);
    return;
}


//*** gettingHot ****************************************************************************************
// Makes all the required changes for mouseover.

function gettingHot() {
var e = window.event.srcElement;
  
  if (e.id.toLowerCase()=="cold")  e.id ="hot";
  else if (e.src== previousCold)  e.src = previousHot;
  else if (e.className.toLowerCase()=="navbar" && e.children.tags("IMG")(0).src== previousCold)  e.children.tags("IMG")(0).src= previousHot;
  else if (e.src== nextCold)  e.src = nextHot;
  else if (e.className.toLowerCase()=="navbar" && e.children.tags("IMG")(0).src== nextCold)  e.children.tags("IMG")(0).src= nextHot;
  
  else if (e.className.toLowerCase()=="shortcut" && e.tagName=="IMG")  e.src = shortcutHot;		    //<img> tags have a class
  else if (e.id.toLowerCase()=="shortcut")  e.children.tags("IMG")(0).src = shortcutHot;			//<a> tags have an ID
  
  else if (e.className.toLowerCase()=="popup" && e.tagName=="IMG")  e.src = popupHot;		    //<img> tags have a class
  else if (e.className.toLowerCase()=="popupicon")  e.children.tags("IMG")(0).src = popupHot;			//<a> tags have an ID
  
  else if ((e.className.toLowerCase()=="expand" && e.tagName=="IMG") ||( e.id.toLowerCase()=="expand")) expandGoesHot(e);
 
}

//*** gettingCold **************************************************************************************
// Initial state for mouseout.

function gettingCold() {
var e = window.event.srcElement;

  if (e.id.toLowerCase()=="hot")  e.id ="cold";
  else if (e.src== previousHot)  e.src = previousCold;
  else if (e.className.toLowerCase()=="navbar" && e.children.tags("IMG")(0).src== previousHot)  e.children.tags("IMG")(0).src= previousCold;
  else if (e.src== nextHot)  e.src = nextCold;
  else if (e.className.toLowerCase()=="navbar" && e.children.tags("IMG")(0).src== nextHot)  e.children.tags("IMG")(0).src= nextCold;
  
  else if (e.className.toLowerCase()=="shortcut" && e.tagName=="IMG")   e.src = shortcutCold;		//<img> tags have a class
  else if (e.id.toLowerCase()=="shortcut")  e.children.tags("IMG")(0).src= shortcutCold;		 	//<a> tags have an ID
  
  else if (e.className.toLowerCase()=="popup" && e.tagName=="IMG")   e.src = popupCold;		//<img> tags have a class
  else if (e.className.toLowerCase()=="popupicon")  e.children.tags("IMG")(0).src= popupCold;		 	//<a> tags have an ID
  
  else if ((e.className.toLowerCase()=="expand" && e.tagName=="IMG") ||( e.id.toLowerCase()=="expand")) expandGoesCold(e);
}

//****************************************** OBJECT CONSTRUCTION **************************************
//*****************************************************************************************************
//  Uses an A tag to pass parameters between an HTML page and this script.
//  Creates an ActiveX Object from these parameters, appends the Object to the end of the page,
//  and clicks it. These objects relate to HTMLHelp environment and information about them can be found on the http://HTMLHelp site.

//  Object construction variables *********************************************************************

var sParamCHM,sParamFILE, sParamEXEC, sParamMETA,iEND;
var sActX_HH= " type='application/x-oleobject' classid='clsid:adb880a6-d8ff-11cf-9377-00aa003b7a11' ";


//*** callPopup ***************************************************************************************
// creates an object from an <A> tag HREF, the object inserts a winhelp popup
// called by: <A ID="wPopup" HREF="HELP=@@file_name.hlp@@ TOPIC=@@topic#@@">@@Popup text@@</A>

function callPopup(eventSrc) {
var e= eventSrc;
var eH= unescape(e.href);
var eH_= eH.toLowerCase();
       event.returnValue = false;
														   	
  var iTOPIC      = eH_.lastIndexOf("topic=");
        if (iTOPIC==-1) return;
        sParamTOPIC = eH.substring((iTOPIC+6),eH.length);  		// extracts the topic for item2
		
  var iHELP       = eH_.lastIndexOf("help=");
        if (iHELP==-1) return;
        sParamHELP = eH.substring(iHELP+5,iTOPIC);			// extracts the help file for item1
		
        if (document.hhPopup) document.hhPopup.outerHTML = "";	// if hhPopup object exists, clears it


 var  h= "<object id='hhPopup'"+ sActX_HH + "STYLE='display:none'><param name='Command' value='WinHelp, Popup'>";
      h= h + "<param name='Item1' value='" + sParamHELP + "'><param name='Item2' value='" + sParamTOPIC + "'></object>";
		
        document.body.insertAdjacentHTML("beforeEnd", h);     
        document.hhPopup.hhclick();
}


//*** callAltLocation******************************************************************************
// creates an object from an <A> tag HREF, the object will navigate to the alternate location if the first location is not found.
// called from: <A ID="altLoc" HREF="CHM=@@1st_chm_name.chm;Alt_chm_name.chm@@  FILE=@@1st_file_name.htm;Alt_file_name.htm@@">@@Link text here@@</A>
   

function callAltLocation(eventSrc) {
var e= eventSrc;
var eH= unescape(e.href);
var eH_= eH.toLowerCase();
var sFILEarray,sCHMarray;
     event.returnValue = false;
	 
  var sParamTXT= e.innerHTML;
      sParamTXT= sParamTXT.replace(semicolon,"");
		   							
  var iFILE = eH_.lastIndexOf("file=");
        if (iFILE==-1) return;
        sParamFILE= eH.substring((iFILE+5),eH.length);  			    // extracts the 2 HTM files
		sParamFILE= sParamFILE.replace(spaces,"");
		iSPLIT= sParamFILE.match(semicolon);
		if (iSPLIT)
  		    sFILEarray = sParamFILE.split(";");										// separates the 2 HTM files
		else return;
  		
  var iCHM  = eH_.lastIndexOf("chm=");
        if(iCHM==-1) return;
        else         sParamCHM = eH.substring(iCHM+4,iFILE);			// extracts the 2 CHM's
		sParamCHM= sParamCHM.replace(spaces,"");
		iSPLIT= sParamCHM.match(semicolon);
		if (iSPLIT)
		    sCHMarray= sParamCHM.split(";");									// separates the 2 CHM's
		else return;
		
		sParamFILE= moniker + sCHMarray[0]+ "::/" + sFILEarray[0] + ";" + moniker + sCHMarray[1]+ "::/" + sFILEarray[1];
				
        if (document.hhAlt) document.hhAlt.outerHTML = "";			    // if hhAlt object exists, clears it

 
  var h= "<object id='hhAlt'"+ sActX_HH + "STYLE='display:none'><PARAM NAME='Command' VALUE='Related Topics'>";
      h= h + "<param name='Item1' value='" + sParamTXT +";" + sParamFILE + "'></object>";
	
        document.body.insertAdjacentHTML("beforeEnd", h); 
        document.hhAlt.hhclick();
}


//*** callRelatedTopics******************************************************************************
// creates an object from an <A> tag HREF, the object inserts a popup of the related topics to select
// called from: <A ID="relTopics" HREF="CHM=@@chm_name1.chm;chm_name2.chm@@ META=@@a_filename1;a_filename2@@">Related Topics</A>
   

function callRelatedTopics(eventSrc) {
var e= eventSrc;
var eH= unescape(e.href);
var eH_= eH.toLowerCase();
     event.returnValue = false;
		   							
  var iMETA = eH_.lastIndexOf("meta=");
        if (iMETA==-1) return;
        sParamMETA = eH.substring((iMETA+5),eH.length);  			// extracts the META keywords for item2
		
  var iCHM  = eH_.lastIndexOf("chm=");
        if(iCHM==-1) sParamCHM = "";
        else         sParamCHM = eH.substring(iCHM+4,iMETA);			// extracts the CHM files for item1
	
        if (document.hhRel) document.hhRel.outerHTML = "";			// if hhRel object exists, clears it

 
  var h= "<object id='hhRel'"+ sActX_HH + "STYLE='display:none'><param name='Command' value='ALink,MENU'>";
      h= h + "<param name='Item1' value='" + sParamCHM + "'><param name='Item2' value='" + sParamMETA + "'></object>";
	
        document.body.insertAdjacentHTML("beforeEnd", h);     
        document.hhRel.hhclick();
}

//*** popNewWindow***************************************************************************************
// creates an object from an <A> tag HREF, the object then opens a new window from the image URL found in the HREF
// called from: <a id="thumbnail" title="Enlarge figure" href="CHM=NTArt.chm FILE=@@image_name.gif@@">@@alt text here@@</A>
// the thumbnail image is loaded by loadPage();


function popNewWindow(eventSrc) {
var eH= eventSrc.href;
      event.returnValue = false;
	  
 // extracts the thumbnail image URL from the <a> tag HREF
    sParamFILE =  getURL(eH);
    if (sParamFILE=="") return;
	   
 // if the hhWindow object exists, clears it
    if (document.hhWindow) document.hhWindow.outerHTML = "";		
		
var  h =  "<object id='hhWindow'"+ sActX_HH +" STYLE='display:none'><param name='Command' value='Related Topics'>";
     h = h + "<param name='Window' value='$global_largeart'><param name='Item1' value='$global_largeart;" + moniker + sParamFILE+ "'> </object>";
	
     document.body.insertAdjacentHTML("beforeEnd", h);
     document.hhWindow.hhclick();
}

//*** callShortcut ***************************************************************************************
// creates an object from an <A> tag, the object then calls the executable code
// called from: <A ID="shortcut" HREF="EXEC=@@executable_name.exe@@ CHM=ntshared.chm FILE=@@error_file_name.htm@@">@@Shortcut text@@</A>
// the shortcut image is loaded by loadInitialImg();

function callShortcut(eventSrc) {
var e= eventSrc;
var eH= unescape(e.href);
var eH_= eH.toLowerCase();


    event.returnValue = false;
	   	   
 // extracts the error file URL from the <a> tag HREF
	iEND= eH.length;
    sParamFILE =  getURL(eH);
	
//code added to redirect if shortcut is nonexisting

var con_mmc;
var doc_mmc;

	doc_mmc = sParamFILE.toLowerCase();
	con_mmc = doc_mmc.indexOf("mmc.chm");
	if (con_mmc != -1){
		doc_mmc = " " + document.location;
		con_mmc = doc_mmc.indexOf("mmc.chm");
		if (con_mmc == -1){
			sParamFILE = "ntshared.chm::/alt_url_deux.htm"
			}
		}
// *************************************************
		
	 
 	
var iEXEC = eH_.lastIndexOf("exec="); 
        if (iEXEC==-1) return;
        else sParamEXEC = eH.substring(iEXEC+5,iEND);				// extracts the executable for item1
		
        if (document.hhShortcut) document.hhShortcut.outerHTML = "";			// if the hhShortcut object exists, clears it
	
var  h =  "<object id='hhShortcut'"+ sActX_HH +" STYLE='display:none'> <param name='Command' value='ShortCut'>";
     if(sParamFILE != "") h = h + "<param name='Window' value='" + moniker + sParamFILE+ "'>";
     h = h + "<param name='Item1' value='" + sParamEXEC + "'><param name='Item2' value='msg,1,1'></object>";

        document.body.insertAdjacentHTML("beforeEnd", h);
        document.hhShortcut.hhclick();
}

//****************************************  EXPAND FUNCTIONS *********************************************************
//********************************************************************************************************************

//**  callExpand **************************************************************************************************
//  This expands & collapses (based on current state) "expandable" nodes as they are clicked.
//  Called by: <A ID="expand" href="#">@@Hot text@@</A>
//  Followed by:  <div class="expand">

function callExpand(eventSrc) {

var e= eventSrc;
    event.returnValue = false;					// prevents navigating for <A> tag
	
var oExpandable = getExpandable(e); 
var oImg = getImage(e);

     if (oExpandable.style.display == "block")
	      doCollapse(oExpandable, oImg);
     else doExpand(oExpandable, oImg);
}

//** expandGoesHot *********************************************************************************************
// Returns expand image to hot. 

function expandGoesHot(eventSrc){
var e= eventSrc;
	
var oExpandable = getExpandable(e);  
var oImg = getImage(e);

    if (oExpandable.style.display == "block") oImg.src = expandHot;
    else oImg.src = closedHot;
}


//** expandGoesCold *********************************************************************************************
// Returns expand image to cold.

function expandGoesCold(eventSrc){
var e= eventSrc;

var oExpandable = getExpandable(e);   
var oImg = getImage(e);

    if (oExpandable.style.display == "block") oImg.src = expand;
    else oImg.src = closed;
}


//** getExpandable *****************************[used by callExpand, expandGoesHot, expandGoesCold]*******
//  Determine if the element is an expandable node or a child of one.  

function getExpandable(eventSrc){
var  e = eventSrc;
var iNextTag, oExpandable;

       for (var i=1;i<4; i++){
               iNextTag=    e.sourceIndex+e.children.length+i;
              oExpandable= document.all(iNextTag);
              if (oExpandable.className.toLowerCase()=="expand" || iNextTag == document.all.length)
                   break;
       }
       return oExpandable;
}

//**  getImage ***********************************[used by callExpand, expandGoesHot, expandGoesCold]*******
//  Find the first image in the children of the current srcElement.   
// (allows the  image to be placed anywhere inside the <A HREF> tag)

function getImage(header) {
var oImg = header;

       if(oImg.tagName != "IMG") oImg=oImg.children.tags("IMG")(0);
       return oImg;
}


//****  expandAll *******************************************************************************************************
//  Will expand or collapse all "expandable" nodes when clicked. [calls closeAll()]
//  called by: <A HREF="#" onclick="expandAll();">expand all</A>

var stateExpand = false;    //applies to the page 

//**** ****************************************************************************************************************

function expandAll() {
var oExpandToggle, oImg;
var expandAllMsg = "expand all";					//message returned when CloseAll() is invoked
var closeAllMsg = "close all";						//message returned when ExpandAll() is invoked
var e= window.event.srcElement;
       event.returnValue = false;

       for (var i=0; i< document.anchors.length; i++){
               oExpandToggle = document.anchors[i];
		 
                if (oExpandToggle.id.toLowerCase() == "expand"){ 
                     oExpandable = getExpandable(oExpandToggle);  
                     oImg = getImage(oExpandToggle);
			 
                     if (stateExpand == true) doCollapse(oExpandable, oImg);
                     else                     doExpand(oExpandable, oImg);
                }
       }
       if (stateExpand == true) {
            stateExpand = false;
            e.innerText= expandAllMsg;
       }
       else {
            stateExpand = true;
            e.innerText= closeAllMsg;
       }
}


//****  doExpand *******************************************************************************************************
//  Expands expandable block & changes image
	
var redo = false;	
function doExpand(oToExpand, oToChange) {
var oExpandable= oToExpand;
var oImg= oToChange;
	
	oImg.src = expand;
	oExpandable.style.display = "block";
	
	if (!redo && !isIE5) {
		redo = true;
		focus(oToExpand);
		doExpand(oToExpand, oToChange);
		}
    
}


//****  doCollapse *****************************************************************************************************
//  Collapses expandable block & changes image
	
function doCollapse(oToCollapse, oToChange) {
if (printing == "TRUE") return;
var oExpandable= oToCollapse;
var oImg= oToChange;

    oExpandable.style.display = "none";
    oImg.src = closed;
}

//*******************************************************************************************************
//******* WEB  FUNCTIONS **************************************************************************
//*******************************************************************************************************

//**** callThumbnailWeb **************************************************************************************

function callThumbnailWeb(eventSrc) {
var e= eventSrc;
       event.returnValue = false;
	   	   	  
var thumbnailWin= window.open (e.href, "$global_largeart",  "height=450, width=600, left=10, top=10, dependent=yes, resizable=yes, status=no, directories=no, titlebar=no, toolbar=yes, menubar=no, location=no","true");

thumbnailWin.document.write ("<html><head><title>Windows 2000</title></head><body><img src='"+e.href+"'></body></html>");

return;
}

//*********************************************************************************************************
//*********************************************************************************************************
								
								
var popupOpen= false;				//state of popups
var posX, posY;						//coordinates of popups
var oPopup;							//object to be used as popup content

//**** callPopupWeb **************************************************************************************
// the web popups have been converted from the object winHelp popup for the web.
// called by: <A ID="wPopupWeb" HREF="#">@@Popup text@@</A>
// followed by: <div class="popup">Popup content</div>


function callPopupWeb(eventSrc) {
var e= eventSrc;
  
  // find the popup <div> that follows <a id="wPopupWeb"></a>
  findPopup(e);
  positionPopup(e)

  oPopup.style.visibility = "visible";
  popupOpen = true;

  return;
}

//**** findPopup ****************************************************************************************

function findPopup(oX){
var e= oX;
var iNextTag;
	
    for (var i=1;i<4; i++){
         iNextTag=    e.sourceIndex + i;
         oPopup= document.all(iNextTag);
         if (oPopup.className.toLowerCase()=="popup" || iNextTag == document.all.length)
             break;
    }
    if (iNextTag != document.all.length) {
        posX = window.event.clientX; 
        posY = window.event.clientY + document.body.scrollTop+10;
	}
	else closePopup();
}

//****  positionPopup ************************************************************************************
// Set size and position of popup.
// If it is off the page, move up, but not past the very top of the page.

function positionPopup(oX){
var e= oX;	
var popupOffsetWidth = oPopup.offsetWidth;

//determine if popup will be offscreen to right
var rightlimit = posX + popupOffsetWidth;
 
  if (rightlimit >= document.body.clientWidth) 
      posX -= (rightlimit - document.body.clientWidth);
  if (posX < 0) posX = 0;
	
//position popup
  oPopup.style.top = posY;
  oPopup.style.left = posX;

var pageBottom = document.body.scrollTop + document.body.clientHeight;
var popupHeight = oPopup.offsetHeight;
  
  if (popupHeight + posY >= pageBottom) {
      if (popupHeight <= document.body.clientHeight)
          oPopup.style.top = pageBottom - popupHeight;
      else
           oPopup.style.top = document.body.scrollTop;
  }
}

//**** closePopup ****************************************************************************************
// Close Popup
function closePopup() {

  oPopup.style.visibility = "hidden";
  popupOpen = false;
  return;
}

//*********************************************  GENERAL FUNCTIONS ************************************************
//**************************************************************************************************************************

//***ajustImg *************************************************************************************************************
// expands an image to the with of the window or shrinks it to 90px

function ajustImg(eventSrc) {
var e= eventSrc;
var fullWidth= document.body.offsetWidth;

    fullWidth = fullWidth - 50;
    if (e.style.pixelWidth==90)
         e.style.pixelWidth=fullWidth;
    else e.style.pixelWidth=90;
}


//**  getURL **************************************[used in callShortcut, popNewWindow& loadPage]********
// extracts the file location (CHM::/HTM) URL 

function getURL(sHREF) {
var spaces= /\s/g
var eH = unescape(sHREF);
	eH = eH.replace(spaces,""); 

var eH_= eH.toLowerCase();
var sParamFILE= "";
var sParamCHM= "";

var iFILE= eH_.lastIndexOf("file=");
    if (iFILE!=-1){
	    iEND= iFILE +1;
        sParamFILE = eH.substring(iFILE+5,eH.length);
    }  

var iCHM  = eH_.lastIndexOf("chm=");
    if (iCHM!=-1){
        iEND  = iCHM +1; 							// iEND used by callShortcut

        sParamCHM = eH.substring(iCHM+4, iFILE);
        sParamFILE= sParamCHM+"::/"+sParamFILE;
    }	
    return sParamFILE;
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

